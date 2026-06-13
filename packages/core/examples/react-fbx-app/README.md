# FBX Chat

An FBX avatar chat app built with `@aituber-onair/core`.
It keeps the same LLM, TTS, speech input, YouTube, Twitch, Comment
Intelligence, and Manneri flow as the VRM sample, while rendering an FBX
character through Three.js.

This example is meant for production-style streaming tests: open it in a
browser, add the page as an OBS Browser Source, and let live comments feed the
AITuber pipeline.

## What this app can do

- Chat with the LLM providers exposed by `@aituber-onair/core`
- Use TTS engines exposed by `@aituber-onair/core`, including local and
  OpenAI-compatible engines
- Render `public/avatar/avatar.fbx`
- Optionally blend `public/avatar/idle.fbx` and `public/avatar/talk.fbx`
- Drive mouth movement from actual audio output volume
  - Morph targets are used when names look like mouth/jaw/viseme targets
  - A jaw-like bone is used as a fallback when present
  - `talk.fbx` is blended in while the avatar is speaking
- Drive simple emotional facial expressions from core screenplay emotion tags
  such as `[happy]`, `[sad]`, `[angry]`, `[surprised]`, or `[relaxed]` when
  matching FBX morph targets are present
- Add subtle procedural breathing and head motion so a static FBX does not look
  frozen between generated lines
- Control the camera on the avatar stage:
  drag to rotate / mouse wheel to zoom / double-click to reset
- Set visuals directly in Settings:
  - Background image upload (PNG/JPG, memory-only)
  - Fixed avatar asset path display (`/avatar/avatar.fbx`)
- Fetch live chat comments from YouTube Live or Twitch, analyze them with
  `@aituber-onair/comment-intelligence`, and send only selected comments into
  the LLM pipeline
- Detect repetitive conversation patterns with `@aituber-onair/manneri`

## Setup

```bash
cd packages/core/examples/react-fbx-app
npm install
npm run dev
```

After launch, open **Settings** and set API keys / provider options.
All settings are saved in `localStorage` (`react-fbx-app-settings`).

## Avatar assets (`public/avatar`)

Place these files in `public/avatar/`:

| File | Required | Description |
|---|---:|---|
| `avatar.fbx` | Yes | Main FBX character model loaded by the viewer |
| `idle.fbx` | No | Idle animation. If omitted, the model's embedded first animation is used when available |
| `talk.fbx` | No | Speaking animation blended in while TTS audio plays |

Notes:

- `idle.fbx` and `talk.fbx` should target the same skeleton/bone names as
  `avatar.fbx`. Mixamo-style exports usually work when all clips are exported
  from the same character rig.
- For best lip-sync, include mouth or viseme morph targets named with words such
  as `mouth`, `jaw`, `viseme`, `aa`, `ah`, or `open`.
- For expressive Oshikoi-style reactions, include facial morph targets named
  with common English cues such as `smile`, `happy`, `frown`, `sad`, `angry`,
  `surprise`, `shock`, `relaxed`, or `calm`. If the LLM response begins with an
  emotion tag, the matching expression is blended during speech.
- If the FBX has no useful morph targets, a jaw-like bone name is used as a
  fallback. If neither exists, only `talk.fbx` and procedural motion will move.
- The app intentionally does not bundle an FBX character. Use assets you have
  the right to stream and redistribute.
- FBX is supported here for creator compatibility. For public web delivery,
  consider converting heavy production avatars to GLB, glTF, or VRM and
  optimizing textures/meshes before deployment.

If `avatar.fbx` is missing or invalid, the app shows a load error on the avatar
stage.

## Stream comments (YouTube Live / Twitch)

This app can analyze live chat comments from YouTube Live or Twitch before
forwarding selected comments into the LLM. Configure it from
**Settings -> Stream**. Only one platform can be active at a time.

### YouTube Live

1. Create an API key in Google Cloud Console with **YouTube Data API v3**
   enabled.
2. Open Settings -> Stream, choose `YouTube`, paste the API key, and enter the
   live video ID (the `v=` parameter of the YouTube Live URL).
3. Adjust the polling interval if needed, then enable the toggle.

### Twitch

This app uses the Twitch browser-based implicit OAuth flow
(`response_type=token`, scope `user:read:chat`). The access token lives only in
`localStorage` inside your browser. No server is involved.

1. Register an application in the
   [Twitch Developer Console](https://dev.twitch.tv/console/apps) and copy the
   Client ID.
2. Add the exact Redirect URL shown in Settings -> Stream -> Twitch. For Vite
   this is usually `http://localhost:5173/`.
3. In Settings -> Stream, choose `Twitch`, paste the Client ID, then click
   **Connect to Twitch** and approve the OAuth prompt.
4. Enter the channel login name, set the dequeue interval, and enable the
   toggle.

## OBS / streaming

1. Run `npm run dev`.
2. Add `http://localhost:5173/` as an OBS Browser Source.
3. Use a 16:9 canvas such as 1920x1080 for the easiest composition.
4. Configure the LLM, TTS, avatar assets, and comment source in Settings.

The app is browser-rendered, so OBS captures the same WebGL avatar, chat UI,
background image, and generated speech playback you see locally.

## Security note on stored credentials

This is a sample app. Provider API keys, YouTube API key, Twitch Client ID, and
Twitch access token are stored **unencrypted in `localStorage`**. Do not use
production-scope credentials here, do not deploy this sample on a shared or
public origin, and rotate keys if the browser storage is shared with other
users.

## Lip-sync tuning

You can tune constants in `src/hooks/useAudioLipsync.ts`:

| Constant | Default | Description |
|---|---:|---|
| `SMOOTH_FACTOR` | `0.5` | Smoothing factor (higher = smoother, 0.0-1.0) |
| `RMS_CEILING` | `0.12` | RMS normalization ceiling (lower = more sensitive mouth movement) |
| `MOUTH_LEVELS` | `5` | Number of mouth-open steps passed to the FBX renderer |

You can tune FBX framing and motion constants in `src/components/AvatarPanel.tsx`.

## Notes for Web Speech API

- Works on **Chrome / Edge** (Chrome recommended)
- Firefox and Safari are not supported
- Mic button is disabled on unsupported browsers
- Requires HTTPS or localhost

## Tech stack

- Vite + React + TypeScript
- `@aituber-onair/core` (LLM + TTS)
- `@aituber-onair/comment-intelligence`
- `@aituber-onair/manneri`
- `three` + `FBXLoader`
- Web Speech API (speech input)
- Web Audio API + `AnalyserNode` (lip-sync analysis)
