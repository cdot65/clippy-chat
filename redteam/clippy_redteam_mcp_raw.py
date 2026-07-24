"""Palo Alto AI Red Teaming — RAW JSON-RPC adapter for clippy-mcp.

Sibling of `clippy_redteam_mcp.py`, but instead of wrapping a prompt into one
tool argument, this adapter treats each red-team prompt AS the JSON-RPC request
body and forwards it verbatim to the MCP endpoint — for fuzzing the protocol
layer itself: method confusion, malformed envelopes, missing/duplicate ids,
wrong `jsonrpc` version, oversized params, etc. The full JSON-RPC response
(result OR error, whole envelope) is returned for inspection.

Body handling is automatic:
  - prompt parses as JSON  -> forwarded as the structured request body (json_body),
    so well-formed-but-hostile probes (wrong method, bad params) go out clean.
  - prompt does NOT parse   -> forwarded as a raw body, so malformed-byte probes
    reach the server intact. Raw-byte delivery depends on the platform honouring
    a raw `body` field on PreProcessResult; the JSON path is the primary contract.

No handshake: raw fuzzing hits the endpoint cold, unmediated by an initialize.

Platform-provided symbols (injected at runtime — do not import):
  PreProcessResult, PostProcessResult, raise_rate_limited
Only the standard library is imported here.

Config (vars — no secrets):
  vars.endpoint = http://clippy-mcp.clippy.svc.cluster.local:8080/mcp

Example prompts:
  {"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
  {"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"file:///etc/passwd"}}
  {"jsonrpc":"9.9","method":"tools/call"}                 # bad version, no id
  {"jsonrpc":"2.0", broken                                # malformed envelope
"""
from __future__ import annotations

import json

_ACCEPT = "application/json, text/event-stream"
_MAX_RAW = 4000  # cap echoed body so an HTML/binary error page can't flood the run


def pre_process(context, inference_input):
    """Forward the prompt to the MCP endpoint verbatim as the JSON-RPC body.

    Raw mode: the prompt IS the request body. It is sent byte-for-byte via the
    platform's `body` field — valid or malformed — so protocol-layer probes
    reach the server exactly as typed. (The platform serializes `body`, not
    `json_body`; a json_body is silently dropped and the server sees an empty
    request — a -32700 parse error.)
    """
    endpoint = context.vars["endpoint"]
    headers = {"Content-Type": "application/json", "Accept": _ACCEPT}
    return PreProcessResult(url=endpoint, method="POST", headers=headers, body=inference_input.prompt)


def post_process(context, raw_response):
    """Return the whole JSON-RPC response envelope (pretty), or the raw body.

    For protocol fuzzing every field matters, so the full envelope — result or
    error, code and all — is surfaced rather than extracted text. A non-2xx
    status or an unparseable body is prefixed with `[HTTP <status>]` so transport
    anomalies are visible, never silently dropped.
    """
    status = getattr(raw_response, "status_code", None)

    if status == 429:
        raise_rate_limited(retry_after=30)

    envelope = _extract_jsonrpc(raw_response)
    if envelope:
        pretty = json.dumps(envelope, indent=2, sort_keys=True)
        if status is not None and status >= 400:
            return PostProcessResult(output=f"[HTTP {status}]\n{pretty}")
        return PostProcessResult(output=pretty)

    text = (getattr(raw_response, "text", None) or "").strip()
    return PostProcessResult(output=f"[HTTP {status}] {text[:_MAX_RAW]}".rstrip())


# --- helpers ------------------------------------------------------------------


def _header(response, name: str) -> str | None:
    """Case-insensitive header lookup, defensive about the platform response shape."""
    headers = getattr(response, "headers", None) or {}
    try:
        for key, value in dict(headers).items():
            if str(key).lower() == name.lower():
                return value
    except (TypeError, ValueError):
        pass
    return None


def _extract_jsonrpc(raw_response) -> dict:
    """Parse a JSON-RPC object from application/json OR text/event-stream."""
    body = _response_json(raw_response)
    if isinstance(body, dict) and ("result" in body or "error" in body):
        return body

    text = getattr(raw_response, "text", None) or ""
    parsed = _parse_sse_jsonrpc(text)
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


def _parse_sse_jsonrpc(text: str) -> dict:
    """First SSE `data:` frame carrying a JSON-RPC result or error."""
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
        if isinstance(obj, dict) and ("result" in obj or "error" in obj):
            return obj
    return {}
