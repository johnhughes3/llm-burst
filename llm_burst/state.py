"""
llm_burst.state
---------------

Stage-2: Persistent tracking of browser windows / tabs.

This module is intentionally *stand-alone* and synchronous so that it can be
used from both sync and async code without requiring an event-loop.

Design
~~~~~~
" LiveSession   in-memory representation that callers (e.g. BrowserAdapter)
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
    group_id: int | None = None  # Chrome tab-group ID (optional)
    page_guid: Optional[str] = None  # Playwright "guid" of the Page (optional)


@dataclass(slots=True)
class TabGroup:
    """Lightweight record for a Chrome tab group."""
    group_id: int
    name: str
    color: str


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
        self._groups: Dict[int, TabGroup] = {}     # New: tab-group registry
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
                group_id=item.get("group_id"),   # NEW
                page_guid=None,
            )

        # NEW: load tab groups
        for g in raw.get("groups", []):
            self._groups[g["group_id"]] = TabGroup(
                group_id=g["group_id"],
                name=g.get("name", f"group-{g['group_id']}"),
                color=g.get("color", "grey"),
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
            "version": 2,   # bumped
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "sessions": [
                {
                    "task_name": s.task_name,
                    "provider": s.provider.name,
                    "target_id": s.target_id,
                    "window_id": s.window_id,
                    "group_id": s.group_id,
                }
                for s in self._sessions.values()
            ],
            "groups": [
                {
                    "group_id": g.group_id,
                    "name": g.name,
                    "color": g.color,
                }
                for g in self._groups.values()
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
        group_id: int | None = None,
        page_guid: str | None = None,
    ) -> LiveSession:
        """
        Insert or replace a session entry and immediately persist to disk.

        Returns the LiveSession instance that is now tracked.
        """
        session = LiveSession(task_name, provider, target_id, window_id, group_id, page_guid)
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

    def rename(self, old_name: str, new_name: str) -> Optional[LiveSession]:
        """
        Rename a session from old_name to new_name.
        
        Returns the renamed LiveSession on success, None if:
        - old_name doesn't exist
        - new_name already exists (collision)
        """
        # Check preconditions
        if old_name not in self._sessions:
            return None
        if new_name in self._sessions:
            _LOG.warning("Cannot rename '%s' to '%s': target name already exists", old_name, new_name)
            return None
        
        # Perform rename
        session = self._sessions.pop(old_name)
        session.task_name = new_name
        self._sessions[new_name] = session
        self._persist()
        
        _LOG.info("Renamed session '%s' to '%s'", old_name, new_name)
        return session

    # ----------------  Tab-group helpers  ---------------------------- #

    def register_group(self, group_id: int, name: str, color: str) -> TabGroup:
        """Insert or update a TabGroup definition and persist."""
        grp = TabGroup(group_id, name, color)
        self._groups[group_id] = grp
        self._persist()
        return grp

    def get_group_by_name(self, name: str) -> Optional[TabGroup]:
        """Retrieve a group by its display name."""
        for grp in self._groups.values():
            if grp.name == name:
                return grp
        return None

    def list_groups(self) -> Dict[int, TabGroup]:
        """Return a shallow copy of all known tab groups."""
        return dict(self._groups)

    def assign_session_to_group(self, task_name: str, group_id: int) -> None:
        """Attach an existing session to *group_id* and persist."""
        session = self._sessions.get(task_name)
        if session is None:
            _LOG.warning("assign_session_to_group: unknown task '%s'", task_name)
            return
        session.group_id = group_id
        self._persist()