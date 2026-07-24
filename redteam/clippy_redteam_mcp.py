# Palo Alto AI Red Teaming (Prisma AIRS) custom adapter for the clippy-mcp server.
#
# Each red-team prompt is injected into one argument of a configured MCP tool and
# sent as a JSON-RPC tools/call. The tool's response is returned for inspection.
#
# Platform contract (learned live, 2026-07-24):
#   - PreProcessResult is a pydantic model; the request payload field is
#     json_body and it MUST be a dict/list (a string fails validation). We send
#     the tools/call dict there; the platform serializes it as application/json.
#   - The platform feeds natural-language attack prompts, not JSON-RPC, so the
#     prompt fills a tool argument rather than being the request body.
#   - Editor is fragile: keep string literals free of brackets and backslash
#     escapes, and keep lines short, or paste/validation corrupts the script.
#
# Platform-injected symbols (do not import): PreProcessResult, PostProcessResult.
#
# Config (adapter vars, no secrets):
#   endpoint    (required) http://clippy-mcp.clippy.svc.cluster.local:8080/mcp
#   tool_name   (default get_weather) MCP tool to invoke
#   arg_name    (default location) argument the prompt fills
#   static_args (optional JSON object) other arguments merged under the prompt,
#               e.g. resource/action/folder for scm_config
import json

_A = "application/json, text/event-stream"


def _v(vs, key, default=None):
    try:
        val = vs[key]
    except (KeyError, TypeError):
        return default
    if val is None:
        return default
    return val


def _static(vs):
    raw = _v(vs, "static_args")
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        try:
            p = json.loads(raw)
        except (ValueError, TypeError):
            return {}
        if isinstance(p, dict):
            return p
    return {}


def pre_process(context, inference_input):
    vs = context.vars
    ep = vs["endpoint"]
    tool = _v(vs, "tool_name", "get_weather")
    arg = _v(vs, "arg_name", "location")
    prompt = getattr(inference_input, "prompt", "") or ""
    args = dict(_static(vs))
    args[arg] = prompt
    params = {"name": tool, "arguments": args}
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params}
    h = {"Accept": _A, "Content-Type": "application/json"}
    return PreProcessResult(url=ep, method="POST", headers=h, json_body=body)


def _envelope(raw):
    body = getattr(raw, "json_body", None)
    if isinstance(body, dict):
        return body
    text = getattr(raw, "text", None) or ""
    for line in text.splitlines():
        if line.startswith("data:"):
            chunk = line[5:].strip()
            try:
                obj = json.loads(chunk)
            except (ValueError, TypeError):
                continue
            if isinstance(obj, dict):
                if "result" in obj or "error" in obj:
                    return obj
    return {}


def post_process(context, raw_response):
    st = getattr(raw_response, "status_code", None)
    if st is not None and st >= 400:
        text = getattr(raw_response, "text", None) or ""
        return PostProcessResult(output="adapter_error " + str(st) + " " + text[:400])
    env = _envelope(raw_response)
    err = env.get("error")
    if err is not None:
        if isinstance(err, dict):
            msg = str(err.get("code", "?")) + " " + str(err.get("message", ""))
        else:
            msg = str(err)
        return PostProcessResult(output="mcp_error " + msg)
    res = env.get("result")
    if not isinstance(res, dict):
        return PostProcessResult(output=json.dumps(env))
    parts = []
    for b in res.get("content") or []:
        if isinstance(b, dict) and b.get("type") == "text":
            parts.append(b.get("text", ""))
    out = " ".join(p for p in parts if p).strip()
    if not out:
        out = json.dumps(res)
    if res.get("isError"):
        out = "tool_isError " + out
    return PostProcessResult(output=out)
