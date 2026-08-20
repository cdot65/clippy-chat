from pathlib import Path

ROOT = Path(__file__).parents[2]
APP_MANIFEST = ROOT / "k8s" / "20-app.yaml"
MCP_MANIFEST = ROOT / "k8s" / "60-mcp.yaml"
SECRET_MANIFEST = ROOT / "k8s" / "15-secrets.yaml"

# The two images were pinned to one shared commit until the AIRS gateway
# cutover, which rolled only clippy-chat — nothing in that change touched the
# MCP server, so its published digest is unchanged. They are separate services
# and are allowed to sit on different commits; each is still pinned by tag AND
# digest, which is the property this file exists to enforce.
APP_SHA = "b32fcfbb209d35b625ab6aea290d8811137f31ce"
APP_IMAGE = (
    f"registry.cdot.io/clippy/clippy-chat:sha-{APP_SHA}"
    "@sha256:f04d9731f75ecffe173ba3a0d72145e41cf7de794b68dbb6d65a29fb9ee16357"
)
MCP_SHA = "fe3b2a2ba0135ddb4880c3021c957420aa19664a"
MCP_IMAGE = (
    f"registry.cdot.io/clippy/clippy-mcp:sha-{MCP_SHA}"
    "@sha256:4b57c11d5f910e6f25ae53a860f235706e7c480ebd9d7c77b11cfc5949cccc08"
)


def test_production_images_pin_published_code_by_tag_and_digest():
    app_text = APP_MANIFEST.read_text()
    mcp_text = MCP_MANIFEST.read_text()

    assert app_text.count(f"image: {APP_IMAGE}") == 2
    assert f"image: {MCP_IMAGE}" in mcp_text
    assert "clippy-chat:latest" not in app_text
    assert "clippy-mcp:latest" not in mcp_text


def test_production_manifest_configures_exact_forwarded_identity_policy():
    text = MCP_MANIFEST.read_text()

    for name, value in {
        "MCP_OIDC_ISSUER": "https://auth.dev.cdot.io/realms/truffles",
        "MCP_OIDC_AUDIENCE": "clippy",
        "MCP_OIDC_AUTHORIZED_PARTY": "clippy-mcp-client",
        "MCP_OIDC_REQUIRED_SCOPE": "mcp.invoke",
        "MCP_OIDC_WORKSPACE": "ws-produc-985697",
    }.items():
        assert f"- name: {name}\n              value: {value}" in text


def test_chat_uses_secret_backed_mcp_client_credentials():
    text = APP_MANIFEST.read_text()

    for name in ["MCP_TOKEN_URL", "MCP_CLIENT_ID", "MCP_CLIENT_SECRET"]:
        assert f"- name: {name}" in text
        field = text.split(f"- name: {name}", 1)[1].split("- name:", 1)[0]
        assert "name: clippy-mcp-client" in field
        assert f"key: {name}" in field

    secret_text = SECRET_MANIFEST.read_text()
    assert "name: clippy-mcp-client" in secret_text
    assert "vaults/Truffles/items/Truffles - Keycloak clippy-mcp-client" in secret_text
