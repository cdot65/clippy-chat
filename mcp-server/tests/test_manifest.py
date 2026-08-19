from pathlib import Path

MANIFEST = Path(__file__).parents[2] / "k8s" / "60-mcp.yaml"
APP_MANIFEST = Path(__file__).parents[2] / "k8s" / "20-app.yaml"
SECRET_MANIFEST = Path(__file__).parents[2] / "k8s" / "15-secrets.yaml"


def test_production_manifest_configures_exact_forwarded_identity_policy():
    text = MANIFEST.read_text()

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
