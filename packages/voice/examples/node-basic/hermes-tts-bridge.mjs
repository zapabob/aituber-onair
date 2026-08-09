#!/usr/bin/env node
/**
 * A local OpenAI-compatible TTS bridge for Hermes Agent and Project AIRI.
 *
 * The bridge deliberately binds to loopback by default.  A single synthesis
 * request is returned to AIRI and mirrored as a binary WebSocket frame to a
 * connected AITuber OnAir VRM surface, keeping speech and lip-sync driven by
 * the exact same audio bytes.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const MAX_JSON_BYTES = 256 * 1024;
const MAX_INPUT_LENGTH = 6_000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function isLoopbackHost(host) {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '127.0.0.1' ||
    normalized.startsWith('127.')
  );
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(new Error('request body exceeds the local bridge limit'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('request body must be valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function writeWebSocketFrame(socket, opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  socket.write(Buffer.concat([header, body]));
}

function closeWebSocket(socket, clients) {
  clients.delete(socket);
  if (!socket.destroyed) socket.destroy();
}

function handleWebSocketInput(socket, clients, chunk) {
  // Client frames are masked. The bridge only needs ping/close handling; text
  // input is intentionally ignored because this socket mirrors trusted local
  // synthesized audio rather than exposing a new chat-control surface.
  if (chunk.length < 2) return;
  const opcode = chunk[0] & 0x0f;
  const masked = (chunk[1] & 0x80) !== 0;
  const lengthMarker = chunk[1] & 0x7f;
  let offset = 2;
  let payloadLength = lengthMarker;
  if (lengthMarker === 126) {
    if (chunk.length < 4) return;
    payloadLength = chunk.readUInt16BE(2);
    offset = 4;
  } else if (lengthMarker === 127) {
    if (chunk.length < 10) return;
    const value = chunk.readBigUInt64BE(2);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      return closeWebSocket(socket, clients);
    payloadLength = Number(value);
    offset = 10;
  }
  const maskOffset = offset;
  if (masked) offset += 4;
  if (chunk.length < offset + payloadLength) return;
  let payload = chunk.subarray(offset, offset + payloadLength);
  if (masked) {
    const mask = chunk.subarray(maskOffset, maskOffset + 4);
    payload = Buffer.from(
      payload.map((value, index) => value ^ mask[index % 4]),
    );
  }
  if (opcode === 0x8) {
    writeWebSocketFrame(socket, 0x8);
    return closeWebSocket(socket, clients);
  }
  if (opcode === 0x9) writeWebSocketFrame(socket, 0xa, payload);
}

function isAuthorized(request, token) {
  if (!token) return true;
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(request.headers.authorization || '');
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

function localCorsOrigin(request) {
  const origin = request.headers.origin;
  if (!origin || origin === 'null' || origin.startsWith('app://'))
    return origin || 'null';
  try {
    return isLoopbackHost(new URL(origin).hostname) ? origin : '';
  } catch {
    return '';
  }
}

export function createHermesTtsBridge({
  host = '127.0.0.1',
  model = 'aituber-onair-voice',
  token = '',
  synthesize,
  logger = console,
}) {
  if (typeof synthesize !== 'function')
    throw new TypeError('synthesize must be a function');
  if (!isLoopbackHost(host) && !token) {
    throw new Error(
      'a token is required when the bridge is not bound to loopback',
    );
  }

  const clients = new Set();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    const corsOrigin = localCorsOrigin(request);
    if (corsOrigin) {
      response.setHeader('access-control-allow-origin', corsOrigin);
      response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      response.setHeader(
        'access-control-allow-headers',
        'authorization, content-type',
      );
      response.setHeader('vary', 'origin');
    }

    if (request.method === 'OPTIONS') return response.writeHead(204).end();
    if (!isAuthorized(request, token))
      return json(response, 401, { error: { message: 'unauthorized' } });
    if (request.method === 'GET' && url.pathname === '/health') {
      return json(response, 200, {
        ok: true,
        model,
        websocketClients: clients.size,
      });
    }
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      return json(response, 200, {
        object: 'list',
        data: [{ id: model, object: 'model' }],
      });
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/audio/speech') {
      return json(response, 404, { error: { message: 'route not found' } });
    }

    try {
      const body = await readJson(request);
      const input = typeof body.input === 'string' ? body.input.trim() : '';
      if (!input || input.length > MAX_INPUT_LENGTH) {
        return json(response, 400, {
          error: {
            message: `input must contain 1-${MAX_INPUT_LENGTH} characters`,
          },
        });
      }
      const speed = typeof body.speed === 'number' ? body.speed : 1;
      if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
        return json(response, 400, {
          error: { message: 'speed must be between 0.25 and 4' },
        });
      }
      const voice = typeof body.voice === 'string' ? body.voice.trim() : '';
      if (
        voice.length > 128 ||
        [...voice].some((character) => character.charCodeAt(0) < 32)
      ) {
        return json(response, 400, {
          error: { message: 'voice contains invalid characters' },
        });
      }

      const audio = Buffer.from(await synthesize({ input, voice, speed }));
      if (audio.length === 0) throw new Error('voice engine returned no audio');
      for (const socket of [...clients]) {
        try {
          writeWebSocketFrame(socket, 0x2, audio);
        } catch {
          closeWebSocket(socket, clients);
        }
      }
      response.writeHead(200, {
        'content-type': 'audio/wav',
        'content-length': audio.length,
        'cache-control': 'no-store',
      });
      response.end(audio);
    } catch (error) {
      logger.warn?.(
        'Hermes TTS bridge synthesis failed:',
        error instanceof Error ? error.message : error,
      );
      json(response, 502, { error: { message: 'speech synthesis failed' } });
    }
  });

  server.on('upgrade', (request, socket) => {
    const url = new URL(request.url || '/', 'http://localhost');
    const key = request.headers['sec-websocket-key'];
    if (
      url.pathname !== '/v1/events' ||
      typeof key !== 'string' ||
      !isAuthorized(request, token)
    ) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    const accept = createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    );
    clients.add(socket);
    socket.on('data', (chunk) => handleWebSocketInput(socket, clients, chunk));
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  return {
    server,
    async listen(port) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      return server.address();
    },
    async close() {
      for (const socket of clients) closeWebSocket(socket, clients);
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export function parseBridgeArgs(args) {
  const values = {
    host: '127.0.0.1',
    port: 5177,
    engine: 'voicevox',
    endpoint: 'http://127.0.0.1:50021',
    model: 'aituber-onair-voice',
    voice: '8',
    apiKeyEnv: '',
    tokenEnv: '',
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    const key = {
      '--host': 'host',
      '--port': 'port',
      '--engine': 'engine',
      '--endpoint': 'endpoint',
      '--model': 'model',
      '--voice': 'voice',
      '--api-key-env': 'apiKeyEnv',
      '--token-env': 'tokenEnv',
    }[arg];
    if (!key || next === undefined) continue;
    values[key] = key === 'port' ? Number(next) : next;
    index += 1;
  }
  if (
    !Number.isInteger(values.port) ||
    values.port < 1024 ||
    values.port > 65535
  ) {
    throw new Error('port must be between 1024 and 65535');
  }
  return values;
}

export async function createVoiceSynthesizer(options) {
  const { VoiceEngineAdapter } = await import('@aituber-onair/voice');
  const base = {
    engineType: options.engine,
    speaker: options.voice,
    apiKey: options.apiKeyEnv ? process.env[options.apiKeyEnv] || '' : '',
  };
  if (options.engine === 'voicevox') base.voicevoxApiUrl = options.endpoint;
  if (options.engine === 'aivisSpeech')
    base.aivisSpeechApiUrl = options.endpoint;
  if (options.engine === 'openaiCompatible') {
    base.openAiCompatibleApiUrl = options.endpoint;
    base.openAiCompatibleModel = options.model;
  }
  if (options.engine === 'openai') base.openAiModel = options.model;

  return async ({ input, voice, speed }) => {
    let output = null;
    const service = new VoiceEngineAdapter({
      ...base,
      speaker: voice || base.speaker,
      ...(options.engine === 'openaiCompatible'
        ? { openAiCompatibleSpeed: speed }
        : {}),
      onPlay: async (audio) => {
        output = audio;
      },
    });
    await service.speakText(input);
    if (!output) throw new Error('voice service did not provide audio');
    return output;
  };
}

async function main() {
  const options = parseBridgeArgs(process.argv.slice(2));
  const token = options.tokenEnv ? process.env[options.tokenEnv] || '' : '';
  const synthesize = await createVoiceSynthesizer(options);
  const bridge = createHermesTtsBridge({
    host: options.host,
    model: options.model,
    token,
    synthesize,
  });
  const address = await bridge.listen(options.port);
  const port =
    typeof address === 'object' && address ? address.port : options.port;
  console.log(
    `HERMES_AITUBER_TTS_READY host=${options.host} port=${port} model=${options.model}`,
  );
  const shutdown = async () => {
    await bridge.close().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
