import type { PreparedTrail } from '../trail/geometry.ts';
import { buildSimulatedWalk, insertExcursion, sampleAt, walkDurationS, type WalkSample } from './walkScript.ts';

/** Persist this clock with the script so a native task can sample it after a restart. */
export type BenchTimeline = {
  startedAt: number;
  speed: number;
  samples: WalkSample[];
};

/** A native callback supplies the clock. No timer or mounted screen is required. */
export function benchSampleAt(timeline: BenchTimeline, timestamp: number) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(timeline.startedAt) ||
      !Number.isFinite(timeline.speed) || timeline.speed <= 0 || timeline.samples.length === 0 ||
      timestamp < timeline.startedAt) return null;
  const tS = Math.min(walkDurationS(timeline.samples), (timestamp - timeline.startedAt) / 1000 * timeline.speed);
  const sample = sampleAt(timeline.samples, tS);
  return { latitude: sample.latitude, longitude: sample.longitude, accuracyM: 5, timestamp };
}

export function buildBenchTimeline(trail: PreparedTrail, startedAt: number, delay: number): BenchTimeline {
  const walk = buildSimulatedWalk(trail, { excursions: false });
  // Hold at the end of short Trails until the requested excursion time.
  const end = walk[walk.length - 1];
  const held = end.tS < delay ? [...walk, { ...end, tS: delay }] : walk;
  return { startedAt, speed: 1, samples: insertExcursion(trail, held, delay, 'long').samples };
}
