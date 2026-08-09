import { describe, expect, it } from 'vitest';
import { getAvatarPerformanceFrame } from './avatarPerformance';

describe('getAvatarPerformanceFrame', () => {
  it('has a stable, low-amplitude idle motion', () => {
    const frame = getAvatarPerformanceFrame(3, 0, false);

    expect(Math.abs(frame.positionY)).toBeLessThan(0.007);
    expect(Math.abs(frame.rotationY)).toBeLessThan(0.013);
    expect(frame.scaleY).toBeGreaterThan(0.997);
    expect(frame.scaleY).toBeLessThan(1.003);
  });

  it('adds voice-driven movement only while speaking', () => {
    const idle = getAvatarPerformanceFrame(1.25, 1, false);
    const speaking = getAvatarPerformanceFrame(1.25, 1, true);

    expect(speaking.positionY).toBeGreaterThan(idle.positionY);
    expect(speaking.rotationX).toBeGreaterThan(idle.rotationX);
  });
});
