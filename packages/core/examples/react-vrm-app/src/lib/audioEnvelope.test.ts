import { describe, expect, it } from 'vitest';
import { smoothAudioEnvelope } from './audioEnvelope';

describe('smoothAudioEnvelope', () => {
  it('responds faster to a rising signal than to a falling signal', () => {
    const attack = smoothAudioEnvelope(0, 1, 1 / 60);
    const release = smoothAudioEnvelope(1, 0, 1 / 60);

    expect(attack).toBeGreaterThan(1 - release);
  });

  it('keeps invalid input inside the expression-manager range', () => {
    expect(smoothAudioEnvelope(-1, 4, 10)).toBeGreaterThanOrEqual(0);
    expect(smoothAudioEnvelope(-1, 4, 10)).toBeLessThanOrEqual(1);
  });
});
