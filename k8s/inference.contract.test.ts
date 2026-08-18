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

describe('production inference contract', () => {
  it('targets the live in-cluster vLLM service', () => {
    expect(envValue('VLLM_BASE_URL')).toBe(
      'http://vllm-qwen36.vllm.svc.cluster.local:8000',
    )
  })

  it('requests the model ID served by vLLM', () => {
    expect(envValue('VLLM_MODEL')).toBe('qwen36-hauhaucs')
  })
})
