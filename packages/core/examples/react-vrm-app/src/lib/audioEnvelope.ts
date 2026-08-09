const MIN_DELTA_SECONDS = 1 / 240;
const MAX_DELTA_SECONDS = 0.1;

/**
 * Applies frame-rate-independent attack and release smoothing to an audio
 * envelope. The fast attack keeps syllables responsive while the slower
 * release avoids a visibly choppy mouth at word boundaries.
 */
export function smoothAudioEnvelope(
  current: number,
  target: number,
  deltaSeconds: number,
  attackSeconds = 0.045,
  releaseSeconds = 0.16,
): number {
  const safeCurrent = clamp01(current);
  const safeTarget = clamp01(target);
  const safeDelta = Math.min(
    Math.max(deltaSeconds, MIN_DELTA_SECONDS),
    MAX_DELTA_SECONDS,
  );
  const duration = safeTarget > safeCurrent ? attackSeconds : releaseSeconds;
  const blend =
    1 - Math.exp(-safeDelta / Math.max(duration, MIN_DELTA_SECONDS));

  return clamp01(safeCurrent + (safeTarget - safeCurrent) * blend);
}

export function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
