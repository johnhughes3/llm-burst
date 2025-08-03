"""
llm_burst.state
---------------

Stage-2: Persistent tracking of browser windows / tabs.

This module is intentionally *stand-alone* and synchronous so that it can be
used from both sync and async code without requiring an event-loop.

Design
~~~~~~
" LiveSession  in-memory representation that callers (e.g. BrowserAdapter)
  can enrich with transient objects such as Playwright ``Page``.
" The JSON file only stores CDP-level identifiers; Playwright objects are
  reconstructed on re-attach.
" A naive file-lock (fcntl) is employed to guard concurrent writers.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import fcntl
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Any

from .constants import STATE_FILE, LLMProvider

_LOG = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Dataclasses                                                                 #
# --------------------------------------------------------------------------- #

@dataclass(slots=True)
class LiveSession:
    """In-memory representation of an open LLM browser window."""
    task_name: str
    provider: LLMProvider
    target_id: str          # CDP target identifier
    window_id: int          # Chrome window identifier
    page_guid: Optional[str] = None  # Playwright "guid" of the Page (optional)


# --------------------------------------------------------------------------- #
# State Manager (singleton)                                                   #
# --------------------------------------------------------------------------- #

class StateManager:
    """
    Lightweight singleton for reading/writing the llm-burst state file.

    The manager performs eager load on first construction and writes
    synchronously on every mutation (simple but robust for low write volume).
    """

    _instance: "StateManager" | None = None

    # ---------------  construction & internal helpers  -------------------- #

    def __new__(cls, state_file: Path = STATE_FILE) -> "StateManager":
        if cls._instance is None:        # pragma: no cover
            cls._instance = super().__new__(cls)
            cls._instance._init(state_file)
        return cls._instance

    def _init(self, state_file: Path) -> None:
        self._state_file = state_file
        self._sessions: Dict[str, LiveSession] = {}
        self._state_file.parent.mkdir(parents=True, exist_ok=True)
        self._load_from_disk()

    # ---------------  disk I/O  ------------------------------------------- #

    def _load_from_disk(self) -> None:
        if not self._state_file.exists():
            return

        try:
            with self._state_file.open("r") as fp:
                fcntl.flock(fp.fileno(), fcntl.LOCK_SH)
                raw = json.load(fp)
                fcntl.flock(fp.fileno(), fcntl.LOCK_UN)
        except (OSError, json.JSONDecodeError) as exc:
            _LOG.warning("Failed to load state from %s: %s", self._state_file, exc)
            return

        for item in raw.get("sessions", []):
            try:
                provider = LLMProvider[item["provider"]]
            except KeyError:
                _LOG.warning("Unknown provider '%s' in state file", item.get("provider"))
                continue

            self._sessions[item["task_name"]] = LiveSession(
                task_name=item["task_name"],
                provider=provider,
                target_id=item["target_id"],
                window_id=item["window_id"],
                page_guid=None,
            )

    def _write_atomic(self, data: dict) -> None:
        tmp_path = self._state_file.with_suffix(".tmp")
        with tmp_path.open("w") as fp:
            fcntl.flock(fp.fileno(), fcntl.LOCK_EX)
            json.dump(data, fp, indent=2)
            fp.flush()
            os.fsync(fp.fileno())
            fcntl.flock(fp.fileno(), fcntl.LOCK_UN)
        tmp_path.replace(self._state_file)

    def _persist(self) -> None:
        data = {
            "version": 1,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "sessions": [
                {
                    "task_name": s.task_name,
                    "provider": s.provider.name,
                    "target_id": s.target_id,
                    "window_id": s.window_id,
                }
                for s in self._sessions.values()
            ],
        }
        try:
            self._write_atomic(data)
        except OSError as exc:           # pragma: no cover
            _LOG.error("Failed to write state to %s: %s", self._state_file, exc)

    # ---------------  public API  ----------------------------------------- #

    def register(
        self,
        task_name: str,
        provider: LLMProvider,
        target_id: str,
        window_id: int,
        page_guid: str | None = None,
    ) -> LiveSession:
        """
        Insert or replace a session entry and immediately persist to disk.

        Returns the LiveSession instance that is now tracked.
        """
        session = LiveSession(task_name, provider, target_id, window_id, page_guid)
        self._sessions[task_name] = session
        self._persist()
        return session

    def get(self, task_name: str) -> Optional[LiveSession]:
        """Return the session for *task_name* or ``None`` if absent."""
        return self._sessions.get(task_name)

    def remove(self, task_name: str) -> None:
        """Delete a session and persist the change."""
        if task_name in self._sessions:
            del self._sessions[task_name]
            self._persist()

    def list_all(self) -> Dict[str, LiveSession]:
        """Shallow copy of the internal mapping."""
        return dict(self._sessions)