import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  AIRS_GATEWAY_URL: z.url().default('http://airs-gw.airs-gw.svc.cluster.local:80'),
  AIRS_MODEL: z.string().default('@vllm2/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL'),
  // Dedicated Keycloak client (client_credentials grant) clippy-chat uses to mint
  // the bearer JWT it sends to the AI Gateway — separate from clippy-m2m, which
  // is for inbound M2M callers into clippy-chat's own API.
  AIRS_KC_CLIENT_ID: z.string().min(1),
  AIRS_KC_CLIENT_SECRET: z.string().min(1),
  // Stack-segmented client scope (realm now supports per-stack scopes); the
  // gateway token request carries this so the gateway can tell which stack issued it.
  AIRS_KC_SCOPE: z.string().default('clippy-api:prod'),
  MCP_SERVER_URL: z.url().optional(), // unset ⇒ MCP tools disabled
  KC_ISSUER: z.url(),
  KC_CLIENT_ID: z.string().min(1),
  KC_CLIENT_SECRET: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  M2M_SCOPE: z.string().default('clippy-api'),
})

export type Env = z.infer<typeof schema>
export function parseEnv(source: Record<string, string | undefined>): Env {
  return schema.parse(source)
}
let cached: Env | undefined
export function env(): Env {
  return (cached ??= parseEnv(process.env))
}
