import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(
  readFileSync(resolve(import.meta.dirname, '../.forgejo/workflows/ci.yml'), 'utf8'),
)

describe('Forgejo image workflow', () => {
  it('uses Harbor credentials only for push events', () => {
    const steps = workflow.jobs['build-and-push'].steps as Array<Record<string, unknown>>
    const login = steps.find((step) => step.name === 'Log in to Harbor')

    expect(login?.if).toBe("github.event_name == 'push'")
  })
})
