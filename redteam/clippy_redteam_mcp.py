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
    try:
        session_id = _handshake(context, endpoint)
    except Exception as exc:  # noqa: BLE001 — best-effort; probe must still fire
        _dbg(f"handshake failed: {exc!r}; continuing with tools/call")

    arguments = {**static, arg_name: prompt}
    headers = _mcp_headers(session_id)
    # The platform serializes the `body` field, not `json_body` — a json_body is
    # dropped and the server sees an empty request. Serialize the tools/call here.
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    })
    return PreProcessResult(url=endpoint, method="POST", headers=headers, body=body)


def post_process(context, raw_response):
    """Extract tool text (or a clear error string) from the tools/call response."""
    status = getattr(raw_response, "status_code", None)

    if status == 429:
        raise_rate_limited(retry_after=30)

    if status is not None and status >= 400:
        detail = _http_error_detail(raw_response)
        return PostProcessResult(output=f"[adapter error {status}] {detail}")

    envelope = _extract_jsonrpc(raw_response, expected_id=1)
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
    """Trace one handshake/RPC step to stderr when DEBUG_MCP is on.

    stderr keeps the trace out of the adapter's output stream. Unlike the oauth
    adapter there are no secrets to redact here — the MCP server is unauthenticated.
    """
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
    """Headers every MCP request needs. Streamable HTTP requires the caller to
    accept both a single JSON reply and an SSE stream; a session id is echoed
    back only once the server has issued one at initialize.
    """
    headers = {
        "Content-Type": "application/json",
        "Accept": _ACCEPT,
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    return headers


def _header(response, name: str) -> str | None:
    """Case-insensitive header lookup, defensive about the platform's response shape.

    The response object is platform-defined; its `.headers` may be a dict or an
    absent attribute, so every access degrades to None rather than raising.
    """
    headers = getattr(response, "headers", None) or {}
    try:
        for key, value in dict(headers).items():
            if str(key).lower() == name.lower():
                return value
    except (TypeError, ValueError):
        pass
    return None


def _handshake(context, endpoint: str) -> str | None:
    """initialize → notifications/initialized. Returns the session id (or None).

    The `initialize` response is the part that matters: it issues the session id
    (on a stateful server) and the negotiated protocolVersion. The follow-up
    `initialized` notification is fire-and-forget — a stateless server ignores
    it, so its failure must NOT discard the session id we already captured.
    """
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
    envelope = _extract_jsonrpc(init_res, expected_id=0)
    result = envelope.get("result") if isinstance(envelope, dict) else None
    protocol = result.get("protocolVersion") if isinstance(result, dict) else _PROTOCOL_VERSION

    # Best-effort: preserve the captured session id even if the notification fails.
    notif_body = {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}
    _dbg(f"--> notifications/initialized session={session_id!r} protocol={protocol}")
    try:
        notif_res = context.http.post(endpoint, headers=_mcp_headers(session_id), json=notif_body)
        _dbg(f"<-- notifications/initialized HTTP {getattr(notif_res, 'status_code', None)}")
    except Exception as exc:  # noqa: BLE001 — notification is fire-and-forget
        _dbg(f"notifications/initialized failed: {exc!r}; keeping session {session_id!r}")

    return session_id


def _extract_jsonrpc(raw_response, expected_id=None) -> dict:
    """Parse a JSON-RPC response object from application/json OR text/event-stream.

    A streamable-HTTP POST answers as either a single JSON object or an SSE
    stream of frames; a stateful server may interleave progress/notification
    frames, so when `expected_id` is given we return the response whose `id`
    matches the request, falling back to the first result/error otherwise.
    """
    body = _response_json(raw_response)
    if isinstance(body, dict) and ("result" in body or "error" in body):
        return body

    text = getattr(raw_response, "text", None) or ""
    parsed = _parse_sse_jsonrpc(text, expected_id)
    if parsed:
        return parsed

    return body if isinstance(body, dict) else {}


def _response_json(raw_response):
    """Best-effort read of a JSON body from the platform's response object."""
    body = getattr(raw_response, "json_body", None)
    if body is not None:
        return body
    json_fn = getattr(raw_response, "json", None)
    if callable(json_fn):
        try:
            return json_fn()
        except (ValueError, TypeError):
            return None
    text = getattr(raw_response, "text", None) or ""
    if text.strip().startswith("{"):
        try:
            return json.loads(text)
        except (ValueError, TypeError):
            return None
    return None


def _parse_sse_jsonrpc(text: str, expected_id=None) -> dict:
    """Scan SSE `data:` frames for the JSON-RPC response.

    Returns the frame whose `id` matches `expected_id` when set; otherwise the
    first frame carrying a `result` or `error`.
    """
    fallback = {}
    for frame in text.split("\n\n"):
        data = "\n".join(
            line[len("data:"):].strip()
            for line in frame.splitlines()
            if line.startswith("data:")
        )
        if not data:
            continue
        try:
            obj = json.loads(data)
        except (ValueError, TypeError):
            continue
        if not (isinstance(obj, dict) and ("result" in obj or "error" in obj)):
            continue
        if expected_id is not None and obj.get("id") == expected_id:
            return obj
        if not fallback:
            fallback = obj
    return fallback if expected_id is None else (fallback or {})


def _http_error_detail(raw_response) -> str:
    """Pull a human-readable detail from a non-2xx response for the error string.

    Prefers a JSON error envelope ({error} or {message}); falls back to truncated
    raw text so an unexpected error shape is still debuggable, never blank.
    """
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
