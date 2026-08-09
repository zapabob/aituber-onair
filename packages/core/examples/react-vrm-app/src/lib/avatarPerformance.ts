import { clamp01 } from './audioEnvelope';

export interface AvatarPerformanceFrame {
  positionY: number;
  rotationX: number;
  rotationY: number;
  scaleY: number;
  gazeX: number;
  gazeY: number;
}

/**
 * Produces a small, repeatable layer of avatar movement that can be applied
 * above a VRMA clip. Keeping this layer on the scene root avoids making
 * assumptions about the bones or custom expressions in a user's VRM.
 */
export function getAvatarPerformanceFrame(
  elapsedSeconds: number,
  audioEnergy: number,
  isSpeaking: boolean,
): AvatarPerformanceFrame {
  const time = Math.max(0, elapsedSeconds);
  const energy = isSpeaking ? clamp01(audioEnergy) : 0;
  const breath = Math.sin(time * Math.PI * 0.48);
  const sway = Math.sin(time * Math.PI * 0.22 + 0.7);
  const speechSway = Math.sin(time * Math.PI * 1.4 + 0.35) * energy;

  return {
    positionY: breath * 0.006 + energy * 0.004,
    rotationX: breath * 0.008 + energy * 0.012,
    rotationY: sway * 0.012 + speechSway * 0.018,
    scaleY: 1 + breath * 0.0025,
    gazeX: sway * 0.04 + speechSway * 0.025,
    gazeY: breath * 0.025 + energy * 0.018,
  };
}
