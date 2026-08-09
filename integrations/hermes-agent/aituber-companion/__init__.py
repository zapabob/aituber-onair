"""Standalone Hermes plugin for the AITuber OnAir + AIRI desktop companion."""

from __future__ import annotations

from . import core
from .cli import aituber_companion_command, register_cli


def register(ctx) -> None:
    tools = {
        "aituber_companion_status": core.STATUS_SCHEMA,
        "aituber_companion_configure": core.CONFIGURE_SCHEMA,
        "aituber_companion_start": core.START_SCHEMA,
        "aituber_companion_stop": core.STOP_SCHEMA,
    }
    handlers = {
        "aituber_companion_status": core.handle_status,
        "aituber_companion_configure": core.handle_configure,
        "aituber_companion_start": core.handle_start,
        "aituber_companion_stop": core.handle_stop,
    }
    for name, schema in tools.items():
        ctx.register_tool(
            name=name,
            toolset="aituber_companion",
            schema=schema,
            handler=handlers[name],
            check_fn=core.check_available,
            description=schema["description"],
            emoji="🧸",
        )

    ctx.register_cli_command(
        name="aituber-companion",
        help="Run AITuber OnAir voice through the Project AIRI desktop companion",
        setup_fn=register_cli,
        handler_fn=aituber_companion_command,
        description=(
            "Starts the local AITuber OnAir OpenAI-compatible TTS bridge, then "
            "seeds the same endpoint into the installed AIRI Hermes plugin."
        ),
    )
