"""
llm_burst.tab_groups
--------------------

Thin sync façade for Chrome Tab-Group operations so CLI code can remain
synchronous, mirroring the bridge helpers in llm_burst.cli.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict

from .browser import BrowserAdapter
from .state import TabGroup, StateManager

_LOG = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Low-level async helpers                                                     #
# --------------------------------------------------------------------------- #


async def _async_create_group(name: str, color: str) -> TabGroup:
    async with BrowserAdapter() as adapter:
        # Pick an arbitrary window for creation (use first existing or create)
        state = StateManager()
        sessions = state.list_all()
        if sessions:
            window_id = next(iter(sessions.values())).window_id
        else:
            # Spawn a temporary blank window to obtain a windowId
            target_id = await adapter._create_blank_window()
            cdp = await adapter._get_cdp_connection()
            if not cdp:
                raise RuntimeError("No CDP connection available")
            res = await cdp.send("Browser.getWindowForTarget", {"targetId": target_id})
            window_id = res["windowId"]

        await adapter._get_or_create_group(name, color, window_id)
        return state.get_group_by_name(name)  # type: ignore[return-value]


async def _async_move_to_group(task_name: str, group_name: str) -> None:
    async with BrowserAdapter() as adapter:
        await adapter.move_task_to_group(task_name, group_name)


# --------------------------------------------------------------------------- #
# Public sync bridge                                                          #
# --------------------------------------------------------------------------- #


def create_group_sync(name: str, color: str = "grey") -> TabGroup:
    """Create (or fetch) a Chrome tab group and return its metadata."""
    return asyncio.run(_async_create_group(name, color))


def move_to_group_sync(task_name: str, group_name: str) -> None:
    """Move an existing task’s tab into *group_name*."""
    asyncio.run(_async_move_to_group(task_name, group_name))


def list_groups_sync() -> Dict[int, TabGroup]:
    """Return a mapping of group_id → TabGroup."""
    return StateManager().list_groups()


def ungroup_target_sync(target_id: str) -> None:
    """Remove the tab identified by targetId from its Chrome tab group (if any), and update state."""
    asyncio.run(_async_ungroup_target(target_id))


async def _async_ungroup_target(target_id: str) -> None:
    """Remove a tab from its Chrome tab group."""
    async with BrowserAdapter() as adapter:
        cdp = await adapter._get_cdp_connection()
        if not cdp:
            raise RuntimeError("No CDP connection available")

        # Use the TabGroups experimental CDP domain to remove tab from its group
        try:
            await cdp.send("TabGroups.removeTab", {"tabId": target_id})
        except Exception as exc:
            # Some Chrome builds might not expose removeTab; ignore if it fails softly
            _LOG.warning(f"Failed to ungroup tab {target_id}: {exc}")
            # Don't raise - continue to clear state even if CDP call fails

        # Clear group_id in state for the matching LiveSession
        state = StateManager()
        for task_name, s in state.list_all().items():
            if s.target_id == target_id:
                # assign_session_to_group accepts None at runtime; type is not enforced
                state.assign_session_to_group(task_name, None)  # type: ignore[arg-type]
                break
