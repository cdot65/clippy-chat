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
}).superRefine((value, context) => {
  // AIRS rejects an unauthenticated caller outright, so an unset key is a boot
  // failure rather than a 401 on the first chat turn.
  if (value.INFERENCE_AUTH_MODE === 'gateway' && !value.INFERENCE_API_KEY)
    context.addIssue({ code: 'custom', path: ['INFERENCE_API_KEY'], message: 'INFERENCE_API_KEY required with INFERENCE_AUTH_MODE=gateway' })
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
