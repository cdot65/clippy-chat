"""scm_config — CRUD against Strata Cloud Manager candidate config via pan-scm-sdk.

SAFETY: candidate config only. This module must never grow a commit/push/apply
operation — pushes are manual, in the SCM UI (spec decision 2026-07-24).
"""
import os
from typing import Any

from mcp.server.fastmcp import FastMCP

RESOURCES = ("address", "address_group", "service", "tag", "security_rule")
ACTIONS = ("list", "get", "create", "update", "delete")

_cached_client: Any = None


def _client() -> Any:
    global _cached_client
    if _cached_client is None:
        cid, secret, tsg = (os.environ.get(k) for k in
                            ("SCM_CLIENT_ID", "SCM_CLIENT_SECRET", "SCM_TSG_ID"))
        if not (cid and secret and tsg):
            raise RuntimeError("SCM credentials not configured")
        from scm.client import Scm  # import here: heavy, and absent in some test envs

        _cached_client = Scm(client_id=cid, client_secret=secret, tsg_id=tsg)
    return _cached_client


def _dump(obj: Any) -> Any:
    return obj.model_dump(exclude_none=True) if hasattr(obj, "model_dump") else obj


async def scm_config(resource: str, action: str, payload: dict | None = None) -> dict:
    if resource not in RESOURCES:
        return {"error": f"unknown resource {resource!r}; one of {RESOURCES}"}
    if action not in ACTIONS:
        return {"error": f"unknown action {action!r}; one of {ACTIONS} (no push/commit — manual only)"}
    p = dict(payload or {})
    try:
        svc = getattr(_client(), resource)
        if action == "list":
            if "folder" not in p:
                return {"error": "list requires payload.folder (e.g. {'folder': 'Texas'})"}
            return {"items": [_dump(o) for o in svc.list(**p)]}
        if action == "get":
            if "id" in p:
                return {"item": _dump(svc.get(p["id"]))}
            if "name" in p and "folder" in p:
                return {"item": _dump(svc.fetch(name=p["name"], folder=p["folder"]))}
            return {"error": "get requires payload.id, or payload.name + payload.folder"}
        if action == "create":
            if not payload:
                return {"error": "create requires payload (object fields incl. folder)"}
            return {"item": _dump(svc.create(p)), "note": "candidate config — push manually in SCM UI"}
        if action == "update":
            if "id" not in p:
                return {"error": "update requires payload.id plus changed fields"}
            return {"item": _dump(svc.update(p)), "note": "candidate config — push manually in SCM UI"}
        # delete
        if "id" not in p:
            return {"error": "delete requires payload.id"}
        svc.delete(p["id"])
        return {"deleted": p["id"], "note": "candidate config — push manually in SCM UI"}
    except RuntimeError as e:
        return {"error": str(e)}
    except Exception as e:  # noqa: BLE001 — SDK raises many per-API types; surface as text, never traceback
        return {"error": f"SCM {action} {resource} failed: {e}"}


def register(mcp: FastMCP) -> None:
    mcp.tool(description=(
        "CRUD on Strata Cloud Manager (SCM) candidate configuration for this tenant. "
        "resource: address | address_group | service | tag | security_rule. "
        "action: list | get | create | update | delete. "
        "payload: dict of fields — list needs {'folder': ...}; get needs {'id'} or "
        "{'name','folder'}; create needs full object fields incl. 'folder' "
        "(e.g. address: {'folder':'Texas','name':'web1','ip_netmask':'10.0.0.1/32'}); "
        "update needs {'id', ...changed fields}; delete needs {'id'}. "
        "Changes land in CANDIDATE config only — a human pushes them from the SCM UI. "
        "There is no push/commit action. Always confirm details with the user before "
        "create/update/delete."
    ))(scm_config)
