import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const docs = resolve(root, 'docs-site/docs/security')

function read(path: string): string {
  return readFileSync(resolve(docs, path), 'utf8')
}

describe('AI Gateway MCP security handoff documentation', () => {
  it('publishes the complete review set in navigation', () => {
    const sidebar = readFileSync(resolve(root, 'docs-site/sidebars.ts'), 'utf8')

    for (const page of [
      'overview.mdx',
      'architecture.mdx',
      'e2e-testing.mdx',
      'production-evidence.mdx',
      'operations.mdx',
    ]) {
      expect(() => read(page), page).not.toThrow()
    }

    expect(sidebar).toContain("label: 'AI Gateway & MCP Security'")
    for (const id of [
      'security/architecture',
      'security/e2e-testing',
      'security/production-evidence',
      'security/operations',
    ]) {
      expect(sidebar).toContain(`'${id}'`)
    }
  })

  it('documents both authentication modes and exact gateway headers', () => {
    const overview = read('overview.mdx')

    expect(overview).toContain('Org-level JWKS')
    expect(overview).toContain('JWT Validator Guardrail')
    expect(overview).toContain('x-portkey-api-key')
    expect(overview).toContain('X-Auth-Token: Bearer')
    expect(overview).toContain('mcp.invoke')
  })

  it('includes reviewable architecture and request workflows', () => {
    const content = `${read('architecture.mdx')}\n${read('e2e-testing.mdx')}`
    const diagrams = content.match(/```mermaid\n[\s\S]+?```/g) ?? []

    expect(diagrams.length).toBeGreaterThanOrEqual(5)
    expect(content).toContain('sequenceDiagram')
    expect(content).toContain('flowchart')
  })

  it('records sanitized production requests, responses, and denial evidence', () => {
    const evidence = read('production-evidence.mdx')

    expect(evidence).toContain('2026-08-19')
    expect(evidence).toContain('get_current_datetime')
    expect(evidence).toContain('wrong_scope')
    expect(evidence).toContain('401')
    expect(evidence).toContain('403')
    expect(evidence).toContain('[REDACTED')
    expect(evidence).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/)
  })

  it('keeps the required runtime-vault boundary visible', () => {
    const operations = read('operations.mdx')

    expect(operations).toContain('AI Security Academy - Runtime')
    expect(operations).toContain('issues/22')
  })
})
