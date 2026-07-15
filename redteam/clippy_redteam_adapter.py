"""Palo Alto AI Red Teaming — custom adapter for the Clippy chat target.

Verified against the clippy-chat source:
  - POST /api/chat            src/routes/api/chat.ts
  - conversation lifecycle   src/lib/chat/service.ts   (ensureConversation)
  - bearer verification      src/lib/auth/bearer.ts / middleware.ts

Request contract
  Body:  {"conversationId": <uuid>, "message": <str 1..8000>}
  Auth:  Bearer <keycloak m2m access token>, token scope MUST include `clippy-api`
         (verifyBearer rejects tokens missing M2M_SCOPE).
  conversationId: a brand-new uuid is created on first use (ensureConversation),
                  so a fresh uuid per request == a fresh single-turn conversation.

Response contract
  Success (HTTP 200): Server-Sent Events, `content-type: text/event-stream`.
    event: delta   data: {"content": "..."}   -> reply tokens; concatenate these
    event: done    data: {"messageId", "promptTokens", "completionTokens"}  -> ignore
    event: error   data: {"message": "..."}    -> inference failed mid-stream (still 200)
  Errors (JSON envelope, non-2xx): {"error": "..."}
    400 invalid body | 401 unauthorized (bad/expired token) | 404 not found
  clippy itself never returns 429; only the ingress / vLLM upstream might.

Platform-provided symbols (already in the adapter runtime, do not import):
  AuthResult, PreProcessResult, PostProcessResult, raise_rate_limited
Only the standard library is imported here (json, re, uuid).
"""

import json
import re
import uuid

# ---------------------------------------------------------------------------
# Platform injects these (set in the adapter's vars / secrets). Example values
# below use in-cluster DNS; swap in whatever your target/IdP actually expose:
#   vars.auth_url  = http://keycloak.keycloak.svc.cluster.local:8080/realms/myrealm/protocol/openid-connect/token
#   vars.endpoint  = http://clippy-chat.clippy.svc.cluster.local:3000/api/chat
#     ^ points at the app's chat route (Service `clippy-chat`, port 3000).
#   vars.scope     = clippy-api            (optional; default below)
#   secrets.client_id     = clippy-m2m
#   secrets.client_secret = <your IdP client secret>
# ---------------------------------------------------------------------------

_DEFAULT_SCOPE = "clippy-api"


def authenticate(context):
    """Fetch a Keycloak m2m access token (client_credentials grant).

    Runs as its own step; the returned data is cached and surfaced as
    `context.auth` on later pre_process() calls.

    Two things the boilerplate example gets wrong for a real OAuth server:
      - the token endpoint wants a FORM body (curl's `-d`), so use `data=`, not `json=`.
      - `grant_type` and `scope` are required — clippy's verifyBearer rejects any
        token whose `scope` claim is missing `clippy-api`.
    """
    response = context.http.post(
        context.vars["auth_url"],
        data={
            "grant_type": "client_credentials",
            "client_id": context.secrets["client_id"],
            "client_secret": context.secrets["client_secret"],
            "scope": _var(context, "scope", _DEFAULT_SCOPE),
        },
    )
    body = response.json()
    # Cache no longer than the token actually lives so we never send an expired
    # one; refresh ~30s early. Keycloak m2m tokens are often short (e.g. 300s).
    expires_in = int(body.get("expires_in", 300))
    ttl = max(expires_in - 30, 30)
    return AuthResult(ttl=ttl, data={"token": body["access_token"]})


# --- Pattern A: pre_process() + post_process() --------------------------------


def pre_process(context, inference_input):
    """Build the POST /api/chat request for one red-team turn.

    `inference_input.prompt` is the red-team input. A fresh conversationId per
    request keeps every probe an independent single-turn conversation (clippy's
    ensureConversation creates it on first use). The bearer token comes from the
    cached authenticate() result via `context.auth`.
    """
    return PreProcessResult(
        url=context.vars["endpoint"],
        method="POST",
        headers={
            "Authorization": f"Bearer {context.auth['token']}",
            "Content-Type": "application/json",
        },
        json_body={
            "conversationId": str(uuid.uuid4()),
            "message": inference_input.prompt,
        },
    )


def post_process(context, raw_response):
    """Turn clippy's response into the target's text reply.

    Order matters: rate-limit first, then config/auth errors (loud, so a broken
    token or bad body doesn't masquerade as a model response), then the normal
    SSE success body.
    """
    status = raw_response.status_code

    # Not emitted by clippy itself, but the ingress / vLLM upstream can — honour it.
    if status == 429:
        raise_rate_limited(retry_after=30)

    # 400 invalid body | 401 bad/expired token | 404 conversation not found.
    # These are adapter/config faults, not model outputs — surface them clearly.
    # If your SDK exposes a raise_* helper for target/auth errors, prefer it here.
    if status >= 400:
        detail = _json_error(raw_response) or (raw_response.text or "")[:200]
        return PostProcessResult(output=f"[adapter error {status}] {detail}")

    return PostProcessResult(output=_reply_from_stream(raw_response))


# --- helpers ------------------------------------------------------------------


def _var(context, key, default=None):
    """Read an OPTIONAL var without assuming `context.vars` supports `.get()`.

    Required vars (auth_url, endpoint) use direct `[]` indexing elsewhere so a
    misconfiguration fails loudly; this is only for vars that have a default
    (currently `scope`).
    """
    try:
        return context.vars[key]
    except (KeyError, TypeError):
        return default


def _json_error(raw_response):
    """Pull the message out of clippy's JSON error envelope: {"error": "..."}.

    Used by post_process() for non-2xx responses. Returns None if the body
    isn't the expected shape, letting the caller fall back to raw text.
    """
    body = getattr(raw_response, "json_body", None)
    if isinstance(body, dict):
        return body.get("error") or body.get("message")
    return None


def _reply_from_stream(raw_response):
    """Extract the assistant reply from clippy's SSE success body.

    Delegates frame parsing to _parse_sse(), then decides what to hand back:
      - any `delta` content   -> the reply (possibly partial if interrupted)
      - else an `error` event -> surface it so the run shows the failure, not a blank
      - else                  -> raw text, so an unexpected shape is debuggable
    """
    reply, error = _parse_sse(raw_response.text or "")
    if reply:
        return reply
    if error:
        return f"[clippy error] {error}"
    return (raw_response.text or "").strip()


def _parse_sse(text):
    """Parse clippy's `text/event-stream` body into (reply_text, error_message).

    Frames are blank-line separated; each frame carries an `event:` line and a
    single-line `data:` JSON payload (see the `sse()` helper in api/chat.ts):
        event: delta   data: {"content": "..."}   -> reply tokens, concatenated
        event: done    data: {"messageId", ...}    -> end marker, ignored
        event: error   data: {"message": "..."}    -> mid-stream inference failure

    Returns:
        (reply, error) where reply is the joined delta content ("" if none) and
        error is the last error event's message (None if the stream was clean).
    """
    reply = []
    error = None
    for frame in re.split(r"\n\n+", text):
        event = None
        data = None
        for line in frame.splitlines():
            if line.startswith("event:"):
                event = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data = line[len("data:"):].strip()
        if data is None:
            continue
        try:
            payload = json.loads(data)
        except (ValueError, TypeError):
            continue
        if event == "delta":
            chunk = payload.get("content")
            if isinstance(chunk, str):
                reply.append(chunk)
        elif event == "error":
            message = payload.get("message")
            if isinstance(message, str):
                error = message
    return "".join(reply), error
