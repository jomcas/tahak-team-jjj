// Ordered Deviation samples for a single Hike, independent of location source.
import { startDeviationDetector, stepDeviation, type DeviationEvent, type DeviationState } from './detector.ts';
import { locateOnTrail, type PreparedTrail, type TrailLocation } from '../trail/geometry.ts';

export type DeviationProcessing = { detector: DeviationState; toTrail: TrailLocation | null };
export function startDeviationProcessing(): DeviationProcessing {
  return { detector: startDeviationDetector(), toTrail: null };
}
export function processDeviationSample(
  current: DeviationProcessing,
  trail: PreparedTrail,
  sample: { latitude: number; longitude: number; timestamp: number },
): { state: DeviationProcessing; event: DeviationEvent } {
  if (!Number.isFinite(sample.timestamp) || (current.detector.lastMs !== null && sample.timestamp <= current.detector.lastMs)) {
    return { state: current, event: null };
  }
  const toTrail = locateOnTrail(sample, trail);
  if (!toTrail || !Number.isFinite(toTrail.offTrailM)) return { state: current, event: null };
  const result = stepDeviation(current.detector, { offTrailM: toTrail.offTrailM, timestamp: sample.timestamp });
  return { state: { detector: result.state, toTrail }, event: result.event };
}
