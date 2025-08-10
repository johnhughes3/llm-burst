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

import json
import logging
import os
import fcntl
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, NamedTuple

from .constants import STATE_FILE, LLMProvider

_LOG = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Dataclasses                                                                 #
# --------------------------------------------------------------------------- #


# New lightweight tuple for tab metadata
class TabHandle(NamedTuple):
    window_id: int
    tab_id: str


@dataclass(slots=True)
class MultiProviderSession:
    """Stage-3: one logical *task* spanning multiple provider tabs."""

    title: str
    created: str  # ISO timestamp
    grouped: bool
    tabs: Dict[LLMProvider, TabHandle]


@dataclass(slots=True)
class LiveSession:
    """In-memory representation of an open LLM browser window."""

    task_name: str
    provider: LLMProvider
    target_id: str  # CDP target identifier
    window_id: int  # Chrome window identifier
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
        if cls._instance is None:  # pragma: no cover
            cls._instance = super().__new__(cls)
            cls._instance._init(state_file)
        return cls._instance

    def _init(self, state_file: Path) -> None:
        self._state_file = state_file
        self._sessions: Dict[str, LiveSession] = {}  # legacy v1 (per-tab)
        self._multi_sessions: Dict[str, MultiProviderSession] = {}  # NEW v2
        self._groups: Dict[int, TabGroup] = {}  # New: tab-group registry
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

        schema_ver = raw.get("schema", raw.get("version", 1))

        # --- existing v2 loader (multi-provider) unchanged ---
        if schema_ver == 2 or schema_ver == 2.1:
            for sess in raw.get("sessions", []):
                tabs = {
                    LLMProvider[k.upper()]: TabHandle(t["windowId"], t["tabId"])
                    for k, t in sess.get("tabs", {}).items()
                    if k.upper() in LLMProvider.__members__
                }
                self._multi_sessions[sess["title"]] = MultiProviderSession(
                    title=sess["title"],
                    created=sess.get("created", ""),
                    grouped=bool(sess.get("grouped", False)),
                    tabs=tabs,
                )
        else:
            # Legacy upgrade path … (unchanged)
            for item in raw.get("sessions", []):
                provider_name = item.get("provider", "").upper()
                if provider_name not in LLMProvider.__members__:
                    continue
                provider = LLMProvider[provider_name]
                title = item["task_name"]
                sess = self._multi_sessions.get(title)
                if not sess:
                    sess = MultiProviderSession(
                        title=title,
                        created=datetime.now(timezone.utc).isoformat(),
                        grouped=False,
                        tabs={},
                    )
                    self._multi_sessions[title] = sess
                sess.tabs[provider] = TabHandle(item["window_id"], item["target_id"])

        # NEW: hydrate per-tab sessions (LiveSession objects)
        for w in raw.get("windows", []):
            prov_name = w.get("provider", "").upper()
            if prov_name not in LLMProvider.__members__:
                continue
            self._sessions[w["task_name"]] = LiveSession(
                task_name=w["task_name"],
                provider=LLMProvider[prov_name],
                target_id=w["target_id"],
                window_id=w["window_id"],
                group_id=w.get("group_id"),
                page_guid=w.get("page_guid"),
            )

        # NEW: load tab groups (existing code, kept)
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
        """Write the in-memory state to disk in an atomic manner."""
        data = {
            "schema": 2.1,  # ← bumped (back-compat: float value tolerated by previous readers)
            "saved_at": datetime.now(timezone.utc).isoformat(),
            # Per-session (multi-provider) – existing payload unchanged
            "sessions": [
                {
                    "title": s.title,
                    "created": s.created,
                    "grouped": s.grouped,
                    "tabs": {
                        prov.name.lower(): {
                            "windowId": th.window_id,
                            "tabId": th.tab_id,
                        }
                        for prov, th in s.tabs.items()
                    },
                }
                for s in self._multi_sessions.values()
            ],
            # NEW: per-tab LiveSession records
            "windows": [
                {
                    "task_name": s.task_name,
                    "provider": s.provider.name.lower(),
                    "target_id": s.target_id,
                    "window_id": s.window_id,
                    **({"group_id": s.group_id} if s.group_id is not None else {}),
                    **({"page_guid": s.page_guid} if s.page_guid else {}),
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
        except OSError as exc:  # pragma: no cover
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
        session = LiveSession(
            task_name, provider, target_id, window_id, group_id, page_guid
        )
        self._sessions[task_name] = session
        self._persist()
        return session

    def get(self, task_name: str) -> Optional[LiveSession]:
        """Return the session for *task_name* or ``None`` if absent."""
        return self._sessions.get(task_name)

    def get_by_target_id(self, target_id: str) -> Optional[LiveSession]:
        """Return the session matching *target_id* or None if absent."""
        for session in self._sessions.values():
            if session.target_id == target_id:
                return session
        return None

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
            _LOG.warning(
                "Cannot rename '%s' to '%s': target name already exists",
                old_name,
                new_name,
            )
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

    def assign_session_to_group(self, task_name: str, group_id: int | None) -> None:
        """Attach an existing session to *group_id* and persist."""
        session = self._sessions.get(task_name)
        if session is None:
            _LOG.warning("assign_session_to_group: unknown task '%s'", task_name)
            return
        session.group_id = group_id
        self._persist()

    # ----------------  multi-provider helpers  ---------------------------- #

    def create_session(self, title: str) -> MultiProviderSession:
        if title in self._multi_sessions:
            return self._multi_sessions[title]
        sess = MultiProviderSession(
            title=title,
            created=datetime.now(timezone.utc).isoformat(),
            grouped=False,
            tabs={},
        )
        self._multi_sessions[title] = sess
        self._persist()
        return sess

    def get_session(self, title: str) -> Optional[MultiProviderSession]:
        return self._multi_sessions.get(title)

    def add_tab_to_session(
        self,
        title: str,
        provider: LLMProvider,
        window_id: int,
        tab_id: str,
    ) -> None:
        sess = self._multi_sessions.get(title)
        if sess is None:
            sess = self.create_session(title)
        sess.tabs[provider] = TabHandle(window_id, tab_id)
        self._persist()

    def list_sessions(self) -> Dict[str, MultiProviderSession]:
        return dict(self._multi_sessions)

    def set_grouped(self, title: str, grouped: bool) -> None:
        sess = self._multi_sessions.get(title)
        if sess:
            sess.grouped = grouped
            self._persist()

    def rename_session(self, old_title: str, new_title: str) -> bool:
        """
        Rename an existing multi-provider session.

        Parameters
        ----------
        old_title : str
            Current session title.
        new_title : str
            Desired new session title.

        Returns
        -------
        bool
            True on success, False if *old_title* doesn't exist or *new_title*
            collides with an existing session.
        """
        if old_title not in self._multi_sessions:
            return False
        if new_title in self._multi_sessions:
            _LOG.warning(
                "Cannot rename session '%s' to '%s': target already exists",
                old_title,
                new_title,
            )
            return False

        sess = self._multi_sessions.pop(old_title)
        sess.title = new_title
        self._multi_sessions[new_title] = sess
        self._persist()
        _LOG.info("Renamed session '%s' → '%s'", old_title, new_title)
        return True

    # ---------------  public helper  -------------------------------------- #

    def persist_now(self) -> None:
        """Force an immediate state flush to disk."""
        self._persist()
