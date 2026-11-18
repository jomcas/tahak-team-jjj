import { processDeviationSample, startDeviationProcessing, type DeviationProcessing } from '../deviation/processing.ts';
import type { DeviationEvent } from '../deviation/detector.ts';
import { prepareTrail, type LngLat } from '../trail/geometry.ts';

export type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown>; removeItem(key: string): Promise<unknown> };
export type Position = { latitude: number; longitude: number; timestamp: number };
export type BackgroundState = { hikeId: string; startedAt: number; coordinates: readonly LngLat[]; latestPosition: Position | null; deviation: DeviationProcessing };
const KEY = 'hike.backgroundState';

/** Serializes all operations for this processor, including recovery after a storage failure. */
export function createBackgroundStateProcessor(storage: Storage) {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  }
  async function read(): Promise<BackgroundState | null> {
    const value = await storage.getItem(KEY);
    return value === null ? null : JSON.parse(value) as BackgroundState;
  }
  return {
    open(hikeId: string, startedAt: number, coordinates: readonly LngLat[]) {
      return serial(async () => {
        const trail = prepareTrail(coordinates);
        if (!trail || !hikeId || !Number.isFinite(startedAt)) throw new Error('Invalid hike');
        const state: BackgroundState = { hikeId, startedAt, coordinates: trail.coordinates, latestPosition: null, deviation: startDeviationProcessing() };
        await storage.setItem(KEY, JSON.stringify(state));
        return state;
      });
    },
    current() { return serial(read); },
    process(hikeId: string, samples: readonly Position[]) {
      return serial(async () => {
        const state = await read();
        const transitions: NonNullable<DeviationEvent>[] = [];
        if (!state || state.hikeId !== hikeId) return { state, transitions };
        const trail = prepareTrail(state.coordinates);
        if (!trail) throw new Error('Invalid stored trail');
        for (const sample of samples) {
          if (!Number.isFinite(sample.timestamp) || !Number.isFinite(sample.latitude) || !Number.isFinite(sample.longitude) || sample.timestamp < state.startedAt || (state.latestPosition && sample.timestamp <= state.latestPosition.timestamp)) continue;
          const result = processDeviationSample(state.deviation, trail, sample);
          if (result.state === state.deviation) continue;
          state.deviation = result.state;
          state.latestPosition = sample;
          if (result.event) transitions.push(result.event);
        }
        await storage.setItem(KEY, JSON.stringify(state));
        return { state, transitions };
      });
    },
    close(hikeId: string) {
      return serial(async () => {
        const state = await read();
        if (!state || state.hikeId !== hikeId) return false;
        await storage.removeItem(KEY);
        return true;
      });
    },
  };
}
