import { useEffect, useRef, useState } from 'react';

interface HermesCompanionAudioOptions {
  onAudio: (audio: ArrayBuffer) => Promise<void> | void;
}

function bridgeHost(): string {
  const configured = import.meta.env.VITE_HERMES_COMPANION_TTS_HOST?.trim();
  if (configured) return configured;
  return window.location.hostname || '127.0.0.1';
}

function bridgePort(): number {
  const configured = Number(import.meta.env.VITE_HERMES_COMPANION_TTS_PORT);
  return Number.isInteger(configured) && configured >= 1024 && configured <= 65535
    ? configured
    : 5177;
}

/**
 * Mirrors the local Hermes/AIRI TTS bridge audio into this VRM surface.
 *
 * The bridge remains loopback-only by default. This client is receive-only,
 * so the avatar cannot turn a browser connection into a remote chat-control
 * endpoint.
 */
export function useHermesCompanionAudio({
  onAudio,
}: HermesCompanionAudioOptions) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const onAudioRef = useRef(onAudio);

  useEffect(() => {
    onAudioRef.current = onAudio;
  }, [onAudio]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const host = bridgeHost();
      const port = bridgePort();
      socket = new WebSocket(`ws://${host}:${port}/v1/events`);
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        setConnected(true);
        setError('');
      };
      socket.onmessage = (event) => {
        const audio =
          event.data instanceof ArrayBuffer
            ? event.data
            : event.data instanceof Blob
              ? undefined
              : undefined;
        if (audio) {
          Promise.resolve(onAudioRef.current(audio)).catch((playbackError) => {
            setError(
              playbackError instanceof Error
                ? playbackError.message
                : 'Companion audio playback failed.',
            );
          });
          return;
        }
        if (event.data instanceof Blob) {
          event.data
            .arrayBuffer()
            .then((buffer) => onAudioRef.current(buffer))
            .catch(() => setError('Companion audio frame could not be read.'));
        }
      };
      socket.onerror = () => {
        setError('Hermes companion TTS bridge is unavailable.');
      };
      socket.onclose = () => {
        setConnected(false);
        if (!disposed) retryTimer = setTimeout(connect, 2500);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);

  return { connected, error };
}
