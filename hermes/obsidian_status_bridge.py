from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

SOURCE = "hermes-obsidian-status"
SCHEMA = 1


def register(ctx):
    ctx.register_hook("pre_llm_call", _pre_llm_call)
    ctx.register_hook("post_llm_call", _post_llm_call)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_hook("on_session_finalize", _on_session_end)


def _pre_llm_call(**kwargs: Any):
    _write_state("busy", "pre_llm_call", kwargs)
    return None


def _post_llm_call(**kwargs: Any):
    _write_state("idle", "post_llm_call", kwargs)
    return None


def _on_session_end(**kwargs: Any):
    _write_state("idle", "on_session_end", kwargs)
    return None


def _write_state(state: str, reason: str, kwargs: dict[str, Any]) -> None:
    if os.environ.get("OBSIDIAN_HERMES_CONSOLE") != "1":
        return
    path = _resolve_status_path()
    tab_id = os.environ.get("OBSIDIAN_HERMES_TAB_ID", "").strip()
    if not path or not tab_id:
        return
    payload = {
        "schema": SCHEMA,
        "source": SOURCE,
        "updatedAt": _iso_now(),
        "updatedAtMs": int(time.time() * 1000),
        "pid": os.getpid(),
        "tabId": tab_id,
        "state": state,
        "reason": reason,
        "sessionId": kwargs.get("session_id") or "",
        "model": kwargs.get("model") or "",
        "platform": kwargs.get("platform") or "",
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"))
            handle.write("\n")
        os.replace(tmp_name, path)
    except Exception:
        return


def _resolve_status_path() -> Path | None:
    explicit = os.environ.get("OBSIDIAN_HERMES_STATUS_PATH", "").strip()
    if explicit:
        return Path(explicit)
    status_dir = os.environ.get("OBSIDIAN_HERMES_STATUS_DIR", "").strip()
    tab_id = os.environ.get("OBSIDIAN_HERMES_TAB_ID", "").strip()
    if status_dir and tab_id:
        return Path(status_dir) / f"{tab_id}.json"
    return None


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
