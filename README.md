# clippy-chat 📎

A small, complete, self-hosted AI chat web app (Clippy persona) — built as a **worked example
of a [Palo Alto AI Red Teaming](https://www.paloaltonetworks.com/) custom target adapter**.

The chat app is real (browser UI, three auth modes, vLLM streaming, full conversation logging),
but the point of the project is [`redteam/clippy_redteam_adapter.py`](redteam/clippy_redteam_adapter.py):
a heavily-annotated adapter that drives the app's authenticated, SSE chat endpoint as a
red-team target.

## 📚 Documentation

**Full docs: https://cdot65.github.io/clippy-chat/**

- [Red-Team Adapter](https://cdot65.github.io/clippy-chat/red-team/overview) — the centerpiece
- [Getting Started](https://cdot65.github.io/clippy-chat/getting-started)
- [Architecture](https://cdot65.github.io/clippy-chat/architecture)
- [HTTP API Reference](https://cdot65.github.io/clippy-chat/reference/api)

## Quick start

```bash
docker compose up -d db      # postgres:17 on localhost:5433
cp .env.example .env         # fill in placeholders
npm install
npm run db:migrate
npm run dev                  # http://localhost:3000
```

Stack: TanStack Start (React 19, Node 22) · Drizzle ORM + Postgres 17 · Keycloak OIDC + local
admin + machine bearer JWTs · vLLM SSE streaming. See the docs for everything.

> Every hostname, realm, and credential in this repo is a placeholder
> (`chat.example.com`, `auth.example.com`, realm `myrealm`, `changeme`). Supply your own.
