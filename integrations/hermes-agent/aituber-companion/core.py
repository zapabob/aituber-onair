"""Local-only worker supervisor for the AITuber OnAir + AIRI companion mode."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
import re
from typing import Any

PLUGIN = "aituber-companion"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5177
DEFAULT_ENGINE = "voicevox"
DEFAULT_ENDPOINT = "http://127.0.0.1:50021"
DEFAULT_MODEL = "aituber-onair-voice"
DEFAULT_VOICE = "8"
SUPPORTED_ENGINES = {"voicevox", "aivisSpeech", "openaiCompatible", "openai"}

STATUS_SCHEMA = {
    "name": "aituber_companion_status",
    "description": "Inspect local AITuber OnAir TTS bridge and Project AIRI readiness without changing state.",
    "parameters": {"type": "object", "properties": {}},
}
CONFIGURE_SCHEMA = {
    "name": "aituber_companion_configure",
    "description": "Save non-secret AITuber companion settings to Hermes config.yaml.",
    "parameters": {
        "type": "object",
        "properties": {
            "repo_root": {"type": "string"},
            "port": {"type": "integer", "minimum": 1024, "maximum": 65535},
            "engine": {"type": "string", "enum": sorted(SUPPORTED_ENGINES)},
            "endpoint": {"type": "string"},
            "model": {"type": "string"},
            "voice": {"type": "string"},
            "api_key_env": {"type": "string"},
        },
    },
}
START_SCHEMA = {
    "name": "aituber_companion_start",
    "description": "Start the local TTS bridge and seed it into Project AIRI as its speech provider.",
    "parameters": {"type": "object", "properties": CONFIGURE_SCHEMA["parameters"]["properties"]},
}
STOP_SCHEMA = {
    "name": "aituber_companion_stop",
    "description": "Stop this plugin's local TTS bridge; optionally stop the AIRI worker too.",
    "parameters": {
        "type": "object",
        "properties": {"stop_airi": {"type": "boolean"}},
    },
}


def _home() -> Path:
    try:
        from hermes_constants import get_hermes_home

        return get_hermes_home() / PLUGIN
    except Exception:
        return Path.home() / ".hermes" / PLUGIN


def _state_path() -> Path:
    return _home() / "worker-state.json"


def _read_state() -> dict[str, Any]:
    try:
        value = json.loads(_state_path().read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_state(value: dict[str, Any]) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _clear_state() -> None:
    try:
        _state_path().unlink(missing_ok=True)
    except OSError:
        pass


def _config() -> dict[str, Any]:
    try:
        from hermes_cli.config import load_config_readonly

        plugins = (load_config_readonly() or {}).get("plugins") or {}
        entries = plugins.get("entries") if isinstance(plugins, dict) else {}
        entry = entries.get(PLUGIN) if isinstance(entries, dict) else {}
        return dict(entry) if isinstance(entry, dict) else {}
    except Exception:
        return {}


def _setting(values: dict[str, Any], key: str, default: Any) -> Any:
    value = values.get(key)
    if value is None or value == "":
        value = _config().get(key, default)
    return default if value is None or value == "" else value


def _options(values: dict[str, Any] | None = None) -> dict[str, Any]:
    values = values or {}
    host = str(_setting(values, "host", DEFAULT_HOST)).strip()
    # The companion is local by design. A LAN-facing bridge would need a token
    # distribution and explicit browser-origin policy, so this plugin refuses it.
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("companion bridge host must be loopback")
    port = int(_setting(values, "port", DEFAULT_PORT))
    if not 1024 <= port <= 65535:
        raise ValueError("companion bridge port must be between 1024 and 65535")
    engine = str(_setting(values, "engine", DEFAULT_ENGINE)).strip()
    if engine not in SUPPORTED_ENGINES:
        raise ValueError(f"unsupported voice engine: {engine}")
    api_key_env = str(_setting(values, "api_key_env", "")).strip()
    if api_key_env and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", api_key_env):
        raise ValueError("api_key_env must be a valid environment variable name")
    return {
        "host": host,
        "port": port,
        "engine": engine,
        "endpoint": str(_setting(values, "endpoint", DEFAULT_ENDPOINT)).strip(),
        "model": str(_setting(values, "model", DEFAULT_MODEL)).strip(),
        "voice": str(_setting(values, "voice", DEFAULT_VOICE)).strip(),
        "api_key_env": api_key_env,
        "repo_root": str(_setting(values, "repo_root", "")).strip(),
    }


def _repo(values: dict[str, Any] | None = None) -> Path | None:
    root = _options(values).get("repo_root")
    if not root:
        return None
    path = Path(root).expanduser().resolve()
    bridge = path / "packages" / "voice" / "examples" / "node-basic" / "hermes-tts-bridge.mjs"
    return path if bridge.is_file() else None


def _bridge_script(repo: Path) -> Path:
    return repo / "packages" / "voice" / "examples" / "node-basic" / "hermes-tts-bridge.mjs"


def _node() -> str | None:
    return shutil.which("node") or shutil.which("node.exe")


def _npm() -> str | None:
    return shutil.which("npm") or shutil.which("npm.cmd")


def _pid_alive(pid: Any) -> bool:
    try:
        number = int(pid)
        if number <= 0:
            return False
        if os.name == "nt":
            result = subprocess.run(["tasklist", "/FI", f"PID eq {number}", "/NH"], capture_output=True, text=True, check=False)
            return str(number) in result.stdout
        os.kill(number, 0)
        return True
    except Exception:
        return False


def _request(url: str, timeout: float = 2.0) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return {"live": True, "ok": 200 <= response.status < 300, "status": response.status}
    except urllib.error.HTTPError as exc:
        return {"live": True, "ok": False, "status": exc.code}
    except Exception as exc:
        return {"live": False, "ok": False, "error": str(exc)}


def _bridge_url(options: dict[str, Any]) -> str:
    return f"http://{options['host']}:{options['port']}/v1/"


def _health(options: dict[str, Any]) -> dict[str, Any]:
    return _request(f"http://{options['host']}:{options['port']}/health")


def _safe_child_env(api_key_env: str = "") -> dict[str, str]:
    allowed = {
        "APPDATA", "COMSPEC", "HOME", "HOMEDRIVE", "HOMEPATH",
        "LOCALAPPDATA", "PATH", "PATHEXT", "PROGRAMFILES", "SYSTEMDRIVE",
        "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
    }
    if api_key_env:
        allowed.add(api_key_env)
    return {key: value for key, value in os.environ.items() if key in allowed}


def _build_voice_package(repo: Path, npm: str) -> dict[str, Any]:
    result = subprocess.run(
        [npm, "-w", "@aituber-onair/voice", "run", "build"],
        cwd=repo,
        env=_safe_child_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
        check=False,
    )
    return {"ok": result.returncode == 0, "exit_code": result.returncode, "stderr": (result.stderr or "")[-800:]}


def _start_bridge(options: dict[str, Any]) -> dict[str, Any]:
    state = _read_state()
    health = _health(options)
    if _pid_alive(state.get("pid")) and health.get("ok"):
        return {"ok": True, "already_running": True, "url": _bridge_url(options), "health": health}
    repo = _repo(options)
    node, npm = _node(), _npm()
    if repo is None:
        return {"ok": False, "error": "AITuber OnAir repo_root is missing or does not contain the bridge script"}
    if not node or not npm:
        return {"ok": False, "error": "node and npm are required"}
    build = _build_voice_package(repo, npm)
    if not build["ok"]:
        return {"ok": False, "error": "could not build @aituber-onair/voice", "build": build}
    command = [
        node,
        str(_bridge_script(repo)),
        "--host", options["host"],
        "--port", str(options["port"]),
        "--engine", options["engine"],
        "--endpoint", options["endpoint"],
        "--model", options["model"],
        "--voice", options["voice"],
    ]
    if options["api_key_env"]:
        command.extend(["--api-key-env", options["api_key_env"]])
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    process = subprocess.Popen(command, cwd=repo, env=_safe_child_env(options["api_key_env"]), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=creationflags)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        health = _health(options)
        if health.get("ok"):
            _write_state({"pid": process.pid, "started_at": time.time(), "options": {key: options[key] for key in ("host", "port", "engine", "endpoint", "model", "voice", "api_key_env", "repo_root")}})
            return {"ok": True, "pid": process.pid, "url": _bridge_url(options), "health": health}
        if process.poll() is not None:
            return {"ok": False, "error": f"TTS bridge exited with {process.returncode}"}
        time.sleep(0.25)
    process.terminate()
    return {"ok": False, "error": "TTS bridge did not become ready within 20 seconds"}


def _airi_start(options: dict[str, Any]) -> dict[str, Any]:
    try:
        from plugins.airi import core as airi
    except Exception as exc:
        return {"ok": False, "error": f"AIRI Hermes plugin is unavailable: {exc}"}
    try:
        payload = json.loads(airi.start({"tts_base_url": _bridge_url(options), "tts_model": options["model"], "tts_voice": options["voice"], "tts_api_key": "local"}))
        return payload if isinstance(payload, dict) else {"ok": False, "error": "AIRI plugin returned invalid JSON"}
    except Exception as exc:
        return {"ok": False, "error": f"AIRI startup failed: {exc}"}


def check_available() -> bool:
    try:
        return _repo({}) is not None and _node() is not None and _npm() is not None
    except Exception:
        return False


def status(values: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        options = _options(values)
    except (TypeError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}
    state = _read_state()
    bridge = _health(options)
    try:
        from plugins.airi import core as airi

        airi_status = json.loads(airi.status())
    except Exception as exc:
        airi_status = {"ok": False, "error": f"AIRI Hermes plugin is unavailable: {exc}"}
    return {
        "ok": bool(bridge.get("ok")),
        "plugin": PLUGIN,
        "bridge": {"url": _bridge_url(options), "worker_alive": _pid_alive(state.get("pid")), "health": bridge, "model": options["model"], "voice": options["voice"]},
        "airi": airi_status,
        "repo_root": str(_repo(options) or ""),
        "next": [] if bridge.get("ok") else ["hermes aituber-companion configure --repo-root <aituber-onair-path>", "hermes aituber-companion start"],
    }


def configure(values: dict[str, Any] | None = None) -> dict[str, Any]:
    values = values or {}
    try:
        options = _options(values)
        if _repo(options) is None:
            return {"ok": False, "error": "repo_root must contain packages/voice/examples/node-basic/hermes-tts-bridge.mjs"}
        from hermes_cli.config import load_config, save_config

        config = load_config()
        plugins = config.setdefault("plugins", {})
        entries = plugins.setdefault("entries", {})
        entries[PLUGIN] = {key: options[key] for key in ("repo_root", "host", "port", "engine", "endpoint", "model", "voice", "api_key_env")}
        save_config(config)
        return {"ok": True, "config_key": f"plugins.entries.{PLUGIN}", "settings": entries[PLUGIN]}
    except (TypeError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        return {"ok": False, "error": f"Hermes config writer unavailable: {exc}"}


def start(values: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        options = _options(values)
    except (TypeError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}
    bridge = _start_bridge(options)
    if not bridge.get("ok"):
        return {"ok": False, "bridge": bridge}
    airi = _airi_start(options)
    return {"ok": bool(airi.get("ok")), "bridge": bridge, "airi": airi}


def stop(values: dict[str, Any] | None = None) -> dict[str, Any]:
    values = values or {}
    state = _read_state()
    pid = state.get("pid")
    stopped = False
    if _pid_alive(pid):
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, check=False)
            else:
                os.kill(int(pid), 15)
            stopped = True
        except Exception:
            pass
    _clear_state()
    airi: dict[str, Any] | None = None
    if values.get("stop_airi"):
        try:
            from plugins.airi import core as airi_core

            airi = json.loads(airi_core.stop())
        except Exception as exc:
            airi = {"ok": False, "error": str(exc)}
    return {"ok": True, "bridge_stopped": stopped, "airi": airi}


def _json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def handle_status(args: dict[str, Any] | None = None, **_: Any) -> str:
    return _json(status(args))


def handle_configure(args: dict[str, Any] | None = None, **_: Any) -> str:
    return _json(configure(args))


def handle_start(args: dict[str, Any] | None = None, **_: Any) -> str:
    return _json(start(args))


def handle_stop(args: dict[str, Any] | None = None, **_: Any) -> str:
    return _json(stop(args))
