import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHermesTtsBridge,
  parseBridgeArgs,
} from './hermes-tts-bridge.mjs';

test('bridge exposes the OpenAI-compatible health and speech routes', async () => {
  const bridge = createHermesTtsBridge({
    synthesize: async ({ input, voice, speed }) =>
      Buffer.from(`${input}:${voice}:${speed}`),
  });
  const address = await bridge.listen(0);
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const speech = await fetch(`${base}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hello', voice: 'hakua', speed: 1.1 }),
    });
    assert.equal(speech.status, 200);
    assert.equal(speech.headers.get('content-type'), 'audio/wav');
    assert.equal(await speech.text(), 'hello:hakua:1.1');
  } finally {
    await bridge.close();
  }
});

test('bridge mirrors synthesized WAV bytes to local WebSocket listeners', async () => {
  const audio = Buffer.from('shared-wav-bytes');
  const bridge = createHermesTtsBridge({
    synthesize: async () => audio,
  });
  const address = await bridge.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  const socket = new WebSocket(`${base.replace('http', 'ws')}/v1/events`);

  try {
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    const mirrored = new Promise((resolve, reject) => {
      socket.onmessage = async ({ data }) => {
        try {
          resolve(Buffer.from(await data.arrayBuffer()));
        } catch (error) {
          reject(error);
        }
      };
      socket.onerror = reject;
    });
    const response = await fetch(`${base}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'same audio' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await mirrored, audio);
  } finally {
    socket.close();
    await bridge.close();
  }
});

test('bridge rejects non-loopback exposure without a token', () => {
  assert.throws(
    () =>
      createHermesTtsBridge({
        host: '0.0.0.0',
        synthesize: async () => Buffer.alloc(1),
      }),
    /token is required/,
  );
});

test('argument parsing rejects unsafe ports', () => {
  assert.equal(parseBridgeArgs(['--port', '5177']).port, 5177);
  assert.throws(() => parseBridgeArgs(['--port', '80']), /1024/);
});
