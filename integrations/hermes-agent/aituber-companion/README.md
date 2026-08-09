# AITuber OnAir companion plugin for Hermes Agent

This is a standalone local plugin. It does not modify Hermes Agent core or
copy Project AIRI. It starts an OpenAI-compatible speech endpoint implemented
with `@aituber-onair/voice`, then asks the separately installed AIRI Hermes
plugin to use that endpoint as its speech provider.

The bridge also emits the exact returned WAV bytes through
`ws://127.0.0.1:5177/v1/events`. The `react-vrm-app` example subscribes to
that receive-only stream, so its VRM lip-sync and the AIRI desktop companion
share the same generated audio.

## Install

Copy this directory to the active Hermes plugin directory, retaining the
directory name:

```powershell
$pluginRoot = Join-Path $HOME '.hermes/plugins/aituber-companion'
Copy-Item -Recurse -Force integrations/hermes-agent/aituber-companion $pluginRoot
```

The AIRI plugin must already be installed and discoverable as `plugins.airi`.
It owns AIRI's Electron lifecycle and provider seeding; this plugin only owns
the local AITuber OnAir speech bridge.

## Configure and start

```powershell
hermes aituber-companion configure `
  --repo-root 'C:\path\to\aituber-onair' `
  --engine voicevox `
  --endpoint 'http://127.0.0.1:50021' `
  --voice 8

hermes aituber-companion start
hermes aituber-companion status
```

For credentialed engines such as `openai` or `openaiCompatible`, keep the
secret in the shell environment and configure only its variable name. The
plugin carries that one variable to its local child process without writing the
secret to `config.yaml` or its worker-state file.

```powershell
$env:OPENAI_API_KEY = 'set-this-in-your-own-shell'
hermes aituber-companion configure `
  --repo-root 'C:\path\to\aituber-onair' `
  --engine openai `
  --model gpt-4o-mini-tts `
  --voice alloy `
  --api-key-env OPENAI_API_KEY
```

The bridge is loopback-only. It intentionally rejects LAN binding because the
endpoint can use a TTS provider credential and does not implement a remote
user authentication or consent flow.

To render the same audio on the AITuber VRM surface, run the VRM example with
the bridge defaults, or set these Vite environment variables before launch:

```powershell
$env:VITE_HERMES_COMPANION_TTS_HOST = '127.0.0.1'
$env:VITE_HERMES_COMPANION_TTS_PORT = '5177'
npm -w react-vrm-app run dev
```

`hermes aituber-companion stop` only stops the bridge. Use
`hermes aituber-companion stop --stop-airi` when intentionally closing the
Project AIRI desktop worker as well.
