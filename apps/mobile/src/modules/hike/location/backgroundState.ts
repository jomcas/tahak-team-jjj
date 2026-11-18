import { processDeviationSample, startDeviationProcessing, type DeviationProcessing } from '../deviation/processing.ts';
import { prepareTrail, type LngLat } from '../trail/geometry.ts';

export type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown>; removeItem(key: string): Promise<unknown> };
export type Position = { latitude: number; longitude: number; timestamp: number; accuracyM?: number };
export type BackgroundState = { hikeId: string; startedAt: number; coordinates: readonly LngLat[]; latestPosition: Position | null; deviation: DeviationProcessing; alertText?: { title: string; body: string } };
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
    open(hikeId: string, startedAt: number, coordinates: readonly LngLat[], alertText?: { title: string; body: string }) {
      return serial(async () => {
        const trail = prepareTrail(coordinates);
        if (!trail || !hikeId || !Number.isFinite(startedAt)) throw new Error('Invalid hike');
        const state: BackgroundState = { hikeId, startedAt, coordinates: trail.coordinates, latestPosition: null, deviation: startDeviationProcessing(), alertText };
        await storage.setItem(KEY, JSON.stringify(state));
        return state;
      });
    },
    current() { return serial(read); },
    process(hikeId: string, samples: readonly Position[]) {
      return serial(async () => {
        const state = await read();
        const transitions: ({ event: 'started'; position: Position; startedOffM: number } | { event: 'cleared'; position: Position })[] = [];
        if (!state || state.hikeId !== hikeId) return { state, transitions };
        const trail = prepareTrail(state.coordinates);
        if (!trail) throw new Error('Invalid stored trail');
        for (const sample of samples) {
          if (!Number.isFinite(sample.timestamp) || !Number.isFinite(sample.latitude) || !Number.isFinite(sample.longitude) || sample.timestamp < state.startedAt || (state.latestPosition && sample.timestamp <= state.latestPosition.timestamp)) continue;
          const result = processDeviationSample(state.deviation, trail, sample);
          if (result.state === state.deviation) continue;
          state.deviation = result.state;
          state.latestPosition = sample;
          if (result.event === 'started' && result.state.detector.status === 'deviation') transitions.push({ event: 'started', position: sample, startedOffM: result.state.detector.startedOffM });
          else if (result.event === 'cleared') transitions.push({ event: 'cleared', position: sample });
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
