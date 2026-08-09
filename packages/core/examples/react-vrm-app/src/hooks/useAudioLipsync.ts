import { useCallback, useEffect, useRef, useState } from 'react';
import { clamp01, smoothAudioEnvelope } from '../lib/audioEnvelope';

/** Number of mouth animation levels (0-4) */
const MOUTH_LEVELS = 5;
/** RMS normalization ceiling (this value maps to 1.0) */
const RMS_CEILING = 0.12;

interface PlayAudioOptions {
  onStart?: () => void;
}

export function useAudioLipsync() {
  const [mouthLevel, setMouthLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef<number>(0);
  const audioLevelRef = useRef(0);
  const playbackGenerationRef = useRef(0);

  const getAudioContext = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }, []);

  const clearPlayback = useCallback(() => {
    // Stop the currently playing source
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // already stopped
      }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    analyserRef.current = null;
    // Stop the animation loop
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    audioLevelRef.current = 0;
    setMouthLevel(0);
    setAudioLevel(0);
    setIsSpeaking(false);
  }, []);

  const stopCurrent = useCallback(() => {
    playbackGenerationRef.current += 1;
    clearPlayback();
  }, [clearPlayback]);

  const play = useCallback(
    async (
      arrayBuffer: ArrayBuffer,
      options?: PlayAudioOptions,
    ): Promise<void> => {
      // Invalidate previous play requests and reset playback state
      const generation = playbackGenerationRef.current + 1;
      playbackGenerationRef.current = generation;
      clearPlayback();

      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Decode audio data
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      if (generation !== playbackGenerationRef.current) {
        return;
      }

      // Node chain: source -> gain -> analyser -> destination
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      const gain = ctx.createGain();
      gain.gain.value = 1.0;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;

      source.connect(gain);
      gain.connect(analyser);
      analyser.connect(ctx.destination);

      sourceRef.current = source;
      analyserRef.current = analyser;
      setIsSpeaking(true);

      // Analysis loop
      const dataArray = new Float32Array(analyser.fftSize);
      let previousTickAt = window.performance.now();

      const tick = () => {
        if (generation !== playbackGenerationRef.current) return;
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(dataArray);

        // Compute RMS
        let sumSq = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sumSq += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSq / dataArray.length);

        const now = window.performance.now();
        const normalized = clamp01(rms / RMS_CEILING);
        const nextAudioLevel = smoothAudioEnvelope(
          audioLevelRef.current,
          normalized,
          (now - previousTickAt) / 1000,
        );
        previousTickAt = now;
        audioLevelRef.current = nextAudioLevel;

        // Mouth animation level (0-4)
        const level = Math.min(
          Math.round(nextAudioLevel * (MOUTH_LEVELS - 1)),
          MOUTH_LEVELS - 1,
        );

        setMouthLevel(level);
        setAudioLevel(nextAudioLevel);

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);

      // Cleanup when playback ends
      return new Promise<void>((resolve) => {
        source.onended = () => {
          if (generation !== playbackGenerationRef.current) {
            resolve();
            return;
          }
          if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
          }
          analyserRef.current = null;
          audioLevelRef.current = 0;
          setMouthLevel(0);
          setAudioLevel(0);
          setIsSpeaking(false);
          sourceRef.current = null;
          resolve();
        };
        source.start(0);
        options?.onStart?.();
      });
    },
    [clearPlayback, getAudioContext],
  );

  useEffect(() => {
    return () => {
      stopCurrent();
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        void ctxRef.current.close();
      }
    };
  }, [stopCurrent]);

  return {
    mouthLevel,
    isSpeaking,
    audioLevel,
    play,
    stop: stopCurrent,
  };
}
