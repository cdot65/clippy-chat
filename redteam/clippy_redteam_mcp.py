"""Palo Alto AI Red Teaming — custom adapter targeting clippy-mcp directly.

Probes the MCP streamable-HTTP endpoint with JSON-RPC tools/call (not the chat
app). Each red-team prompt fills one configured tool argument; optional
static_args are merged underneath for structured tools like scm_config.

Platform-provided symbols (injected at runtime — do not import):
  PreProcessResult, PostProcessResult, raise_rate_limited
Only the standard library is imported here.

Config (vars — no secrets):
  vars.endpoint   = http://clippy-mcp.clippy.svc.cluster.local:8080/mcp
  vars.tool_name  = get_weather | get_daily_news | get_mlb_scores | polymarket_bets
                    | scm_config | get_current_datetime
  vars.arg_name   = argument the prompt fills (e.g. location, topic, query, name)
  vars.static_args = optional JSON object/string merged into arguments
                     e.g. {"resource":"address","action":"list","payload":{"folder":"Texas"}}
"""

from __future__ import annotations

import json
import sys

DEBUG_MCP = False

_CLIENT_INFO = {"name": "clippy-redteam-mcp", "version": "0.1.0"}
_PROTOCOL_VERSION = "2024-11-05"
_ACCEPT = "application/json, text/event-stream"


def pre_process(context, inference_input):
    """Handshake (best-effort) then return the tools/call PreProcessResult."""
    endpoint = context.vars["endpoint"]
    tool_name = context.vars["tool_name"]
    arg_name = context.vars["arg_name"]
    prompt = inference_input.prompt
    static = _static_args(context.vars)

    session_id = None
    protocol = _PROTOCOL_VERSION
    try:
        session_id, protocol = _handshake(context, endpoint)
    except Exception as exc:  # noqa: BLE001 — best-effort; probe must still fire
        _dbg(f"handshake failed: {exc!r}; continuing with tools/call")

    arguments = {**static, arg_name: prompt}
    headers = _mcp_headers(session_id)
    return PreProcessResult(
        url=endpoint,
        method="POST",
        headers=headers,
        json_body={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        },
    )


def post_process(context, raw_response):
    """Extract tool text (or a clear error string) from the tools/call response."""
    status = getattr(raw_response, "status_code", None)

    if status == 429:
        raise_rate_limited(retry_after=30)

    if status is not None and status >= 400:
        detail = _http_error_detail(raw_response)
        return PostProcessResult(output=f"[adapter error {status}] {detail}")

    envelope = _extract_jsonrpc(raw_response)
    if not envelope:
        text = (getattr(raw_response, "text", None) or "").strip()
        return PostProcessResult(output=text or "[adapter error] empty MCP response")

    if "error" in envelope and envelope["error"] is not None:
        err = envelope["error"] if isinstance(envelope["error"], dict) else {}
        code = err.get("code", "?")
        message = err.get("message", str(envelope["error"]))
        return PostProcessResult(output=f"[mcp error {code}] {message}")

    result = envelope.get("result")
    if not isinstance(result, dict):
        return PostProcessResult(output=json.dumps(envelope))

    texts = [
        block.get("text", "")
        for block in (result.get("content") or [])
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    joined = "\n".join(t for t in texts if t is not None).strip()
    if not joined:
        joined = json.dumps(result)

    if result.get("isError"):
        joined = f"[tool isError] {joined}"
    return PostProcessResult(output=joined)


# --- helpers ------------------------------------------------------------------


def _dbg(message):
    if DEBUG_MCP:
        print(f"[clippy-mcp] {message}", file=sys.stderr)


def _static_args(vars_map) -> dict:
    """Tolerant reader for optional vars.static_args (dict | JSON string | absent)."""
    try:
        raw = vars_map["static_args"]
    except (KeyError, TypeError):
        return {}
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return {}
        return dict(parsed) if isinstance(parsed, dict) else {}
    return {}


def _mcp_headers(session_id: str | None) -> dict:
    headers = {
        "Content-Type": "application/json",
        "Accept": _ACCEPT,
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    return headers


def _header(response, name: str) -> str | None:
    headers = getattr(response, "headers", None) or {}
    try:
        # case-insensitive
        for key, value in dict(headers).items():
            if str(key).lower() == name.lower():
                return value
    except (TypeError, ValueError):
        pass
    try:
        return headers.get(name) or headers.get(name.lower())
    except Exception:  # noqa: BLE001
        return None


def _handshake(context, endpoint: str) -> tuple[str | None, str]:
    """initialize → notifications/initialized. Returns (session_id, protocolVersion)."""
    init_headers = _mcp_headers(None)
    init_body = {
        "jsonrpc": "2.0",
        "id": 0,
        "method": "initialize",
        "params": {
            "protocolVersion": _PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": _CLIENT_INFO,
        },
    }
    _dbg(f"--> initialize {endpoint}")
    init_res = context.http.post(endpoint, headers=init_headers, json=init_body)
    status = getattr(init_res, "status_code", None)
    _dbg(f"<-- initialize HTTP {status}")
    if status is not None and status >= 400:
        raise RuntimeError(f"initialize HTTP {status}")

    session_id = _header(init_res, "Mcp-Session-Id")
    protocol = _PROTOCOL_VERSION
    envelope = _extract_jsonrpc(init_res)
    result = envelope.get("result") if isinstance(envelope, dict) else None
    if isinstance(result, dict) and result.get("protocolVersion"):
        protocol = result["protocolVersion"]

    notif_headers = _mcp_headers(session_id)
    notif_body = {
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
        "params": {},
    }
    _dbg(f"--> notifications/initialized session={session_id!r} protocol={protocol}")
    notif_res = context.http.post(endpoint, headers=notif_headers, json=notif_body)
    nstatus = getattr(notif_res, "status_code", None)
    _dbg(f"<-- notifications/initialized HTTP {nstatus}")
    if nstatus is not None and nstatus >= 400:
        raise RuntimeError(f"notifications/initialized HTTP {nstatus}")

    return session_id, protocol


def _extract_jsonrpc(raw_response) -> dict:
    """Parse a JSON-RPC object from application/json or text/event-stream."""
    content_type = (_header(raw_response, "content-type") or "").lower()

    body = getattr(raw_response, "json_body", None)
    if body is None:
        json_fn = getattr(raw_response, "json", None)
        if callable(json_fn):
            try:
                body = json_fn()
            except Exception:  # noqa: BLE001
                body = None
    if isinstance(body, dict) and ("result" in body or "error" in body or body.get("jsonrpc")):
        if "application/json" in content_type or content_type == "" or body:
            # Prefer structured json when present
            if "result" in body or "error" in body:
                return body

    text = getattr(raw_response, "text", None) or ""
    if "text/event-stream" in content_type or text.lstrip().startswith("event:") or "data:" in text:
        parsed = _parse_sse_jsonrpc(text)
        if parsed:
            return parsed

    if isinstance(body, dict):
        return body

    if text.strip().startswith("{"):
        try:
            obj = json.loads(text)
            if isinstance(obj, dict):
                return obj
        except (ValueError, TypeError):
            pass
    return {}


def _parse_sse_jsonrpc(text: str) -> dict:
    """First SSE data: payload that carries result or error."""
    for frame in text.split("\n\n"):
        data_lines = []
        for line in frame.splitlines():
            if line.startswith("data:"):
                data_lines.append(line[len("data:"):].strip())
        if not data_lines:
            continue
        payload = "\n".join(data_lines)
        try:
            obj = json.loads(payload)
        except (ValueError, TypeError):
            continue
        if isinstance(obj, dict) and ("result" in obj or "error" in obj):
            return obj
    return {}


def _http_error_detail(raw_response) -> str:
    body = getattr(raw_response, "json_body", None)
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            return err.get("message") or json.dumps(err)
        if err is not None:
            return str(err)
        if body.get("message"):
            return str(body["message"])
        return json.dumps(body)[:200]
    text = getattr(raw_response, "text", None) or ""
    return text[:200]
