import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  VLLM_BASE_URL: z.url().default('http://vllm.vllm.svc.cluster.local:8000'),
  VLLM_MODEL: z.string().default('solidrust/Mistral-7B-Instruct-v0.3-AWQ'),
  VLLM_API_KEY: z.string().optional(), // required when vLLM runs with --api-key (cluster)
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
