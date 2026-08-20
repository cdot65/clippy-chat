import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseAllDocuments } from 'yaml'

type Manifest = Record<string, any>

function clippyContainer(): Manifest {
  const path = fileURLToPath(new URL('./20-app.yaml', import.meta.url))
  const deployment = parseAllDocuments(readFileSync(path, 'utf8'))
    .map((document) => document.toJS() as Manifest)
    .find(
      (manifest) =>
        manifest?.kind === 'Deployment' && manifest.metadata?.name === 'clippy-chat',
    )

  expect(deployment, 'Deployment/clippy-chat missing from 20-app.yaml').toBeDefined()

  const container = deployment!.spec.template.spec.containers.find(
    (candidate: Manifest) => candidate.name === 'app',
  )
  expect(container, 'clippy-chat app container missing').toBeDefined()
  return container
}

function envValue(name: string): string | undefined {
  return clippyContainer().env.find((entry: Manifest) => entry.name === name)?.value
}

// NB: these assertions only prove the manifest says what we think it says —
// they cannot prove the target resolves. The previous revision passed green
// through a full production outage because `vllm-qwen36.vllm.svc.cluster.local`
// had stopped existing (NXDOMAIN) while the YAML still named it. Reachability
// belongs in a deploy-time smoke check against /v1/models, not in this file.
describe('production inference contract', () => {
  it('routes inference through the AIRS gateway', () => {
    expect(envValue('INFERENCE_BASE_URL')).toBe('http://airs-gw.airs-gw.svc.cluster.local:80')
  })

  it('requests the model ID the gateway serves', () => {
    expect(envValue('INFERENCE_MODEL')).toBe('@vllm2/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL')
  })

  it('speaks the gateway header contract on both egress paths', () => {
    // direct-mode headers are a 401 against AIRS — see the Security Handoff
    expect(envValue('INFERENCE_AUTH_MODE')).toBe('gateway')
    expect(envValue('MCP_AUTH_MODE')).toBe('gateway')
  })

  it('routes MCP through the workspace gateway route', () => {
    expect(envValue('MCP_SERVER_URL')).toBe(
      'https://mcp-airs.cdot.io/ws-produc-985697/clippy/mcp',
    )
  })
})
