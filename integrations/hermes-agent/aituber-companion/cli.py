"""CLI surface for the standalone AITuber OnAir companion plugin."""

from __future__ import annotations

import argparse
import json

from . import core


def _add_connection_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--repo-root", default="")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--engine", choices=sorted(core.SUPPORTED_ENGINES), default="")
    parser.add_argument("--endpoint", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--voice", default="")


def register_cli(subparser: argparse.ArgumentParser) -> None:
    commands = subparser.add_subparsers(dest="aituber_companion_command")
    commands.add_parser("status", help="Show local bridge and AIRI worker health")
    configure = commands.add_parser("configure", help="Save non-secret companion settings")
    _add_connection_options(configure)
    start = commands.add_parser("start", help="Start bridge and AIRI desktop companion")
    _add_connection_options(start)
    stop = commands.add_parser("stop", help="Stop bridge; AIRI remains open unless requested")
    stop.add_argument("--stop-airi", action="store_true")


def _values(args: argparse.Namespace) -> dict:
    return {key: value for key, value in vars(args).items() if key not in {"aituber_companion_command"} and value not in {None, "", False}}


def _print(value: dict) -> int:
    print(json.dumps(value, ensure_ascii=False, indent=2))
    return 0 if value.get("ok") else 1


def aituber_companion_command(args: argparse.Namespace) -> int:
    command = getattr(args, "aituber_companion_command", "status") or "status"
    values = _values(args)
    if command == "configure":
        return _print(core.configure(values))
    if command == "start":
        return _print(core.start(values))
    if command == "stop":
        return _print(core.stop(values))
    return _print(core.status(values))
