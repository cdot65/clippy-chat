import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  // Inference and MCP both route through the Prisma AIRS gateway in the
  // cluster. `direct` speaks straight to a vLLM/MCP server (dev, CI, and the
  // in-cluster bypass documented in the architecture note); `gateway` speaks
  // AIRS's header contract. The two endpoints are switched independently so a
  // dev box can hit raw vLLM while still using the gateway's MCP route.
  INFERENCE_BASE_URL: z.url().default('http://airs-gw.airs-gw.svc.cluster.local:80'),
  INFERENCE_MODEL: z.string().default('@vllm2/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL'),
  INFERENCE_API_KEY: z.string().optional(), // gateway key (gateway) or --api-key (direct)
  INFERENCE_AUTH_MODE: z.enum(['direct', 'gateway']).default('direct'),
  // Keycloak client_credentials identity for gateway inference (scope
  // completions.write). Separate client from MCP on purpose — see m2m.ts.
  INFERENCE_TOKEN_URL: z.url().optional(),
  INFERENCE_CLIENT_ID: z.string().min(1).optional(),
  INFERENCE_CLIENT_SECRET: z.string().min(1).optional(),
  MCP_SERVER_URL: z.url().optional(), // unset ⇒ MCP tools disabled
  MCP_AUTH_MODE: z.enum(['direct', 'gateway']).default('direct'),
  MCP_TOKEN_URL: z.url().optional(),
  MCP_CLIENT_ID: z.string().min(1).optional(),
  MCP_CLIENT_SECRET: z.string().min(1).optional(),
  KC_ISSUER: z.url(),
  KC_CLIENT_ID: z.string().min(1),
  KC_CLIENT_SECRET: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  M2M_SCOPE: z.string().default('clippy-api'),
  // Expected `aud` on machine bearer tokens. Unset ⇒ audience unchecked, which
  // is the pre-mapper default and the historical behaviour; see bearer.ts. Set
  // it only once the Keycloak client's dedicated scope actually mints this
  // audience, or every machine caller 401s the moment the pods roll.
  M2M_AUDIENCE: z.string().min(1).optional(),
}).superRefine((value, context) => {
  // AIRS rejects an unauthenticated caller outright, so an unset credential is
  // a boot failure rather than a 401 on the first chat turn. Either credential
  // satisfies this: the Keycloak client (preferred) or the legacy static key.
  // Requiring the client triple outright would take the whole app down — env()
  // is lazy and shared, so a parse failure 500s every route, not just chat —
  // during any window where the code ships before the Keycloak client exists.
  // A PARTIAL client triple is deliberately not an error. The Secret is
  // projected field-by-field from a 1Password item, so a half-populated item
  // reaches the pod as two of three vars; failing the schema there would 500
  // every route instead of falling back. inference-auth warns and falls back.
  const inferenceClient = [value.INFERENCE_TOKEN_URL, value.INFERENCE_CLIENT_ID, value.INFERENCE_CLIENT_SECRET]
  if (value.INFERENCE_AUTH_MODE === 'gateway' && !value.INFERENCE_API_KEY && !inferenceClient.every(Boolean))
    context.addIssue({ code: 'custom', path: ['INFERENCE_CLIENT_ID'], message: 'INFERENCE_AUTH_MODE=gateway requires the INFERENCE_CLIENT_* Keycloak client (or a legacy INFERENCE_API_KEY)' })
  if (!value.MCP_SERVER_URL) return
  for (const field of ['MCP_TOKEN_URL', 'MCP_CLIENT_ID', 'MCP_CLIENT_SECRET'] as const) {
    if (!value[field]) context.addIssue({ code: 'custom', path: [field], message: `${field} required with MCP_SERVER_URL` })
  }
})

export type Env = z.infer<typeof schema>
export function parseEnv(source: Record<string, string | undefined>): Env {
  return schema.parse(source)
}
let cached: Env | undefined
export function env(): Env {
  return (cached ??= parseEnv(process.env))
}
