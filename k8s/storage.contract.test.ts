import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseAllDocuments } from 'yaml'

type Manifest = Record<string, any>

function manifests(file: string): Manifest[] {
  const path = fileURLToPath(new URL(file, import.meta.url))
  return parseAllDocuments(readFileSync(path, 'utf8'))
    .map((document) => document.toJS() as Manifest)
    .filter(Boolean)
}

function resource(file: string, kind: string, name: string): Manifest {
  const match = manifests(file).find(
    (manifest) => manifest.kind === kind && manifest.metadata?.name === name,
  )
  expect(match, `${kind}/${name} missing from ${file}`).toBeDefined()
  return match!
}

describe('PostgreSQL storage contract', () => {
  it('stages an unconsumed 10Gi Longhorn target claim', () => {
    const target = resource(
      './11-postgres-longhorn-pvc.yaml',
      'PersistentVolumeClaim',
      'clippy-postgres-data-longhorn',
    )

    expect(target.metadata.namespace).toBe('clippy')
    expect(target.spec.accessModes).toEqual(['ReadWriteOnce'])
    expect(target.spec.storageClassName).toBe('longhorn-replicated')
    expect(target.spec.resources.requests.storage).toBe('10Gi')

    const postgres = resource('./10-postgres.yaml', 'StatefulSet', 'clippy-postgres')
    const source = postgres.spec.volumeClaimTemplates?.find(
      (claim: Manifest) => claim.metadata?.name === 'clippy-postgres-data',
    )
    expect(source?.spec.storageClassName).toBe('local-path')
    expect(source?.spec.resources.requests.storage).toBe('10Gi')

    const explicitClaims = (postgres.spec.template.spec.volumes ?? [])
      .map((volume: Manifest) => volume.persistentVolumeClaim?.claimName)
    expect(explicitClaims).not.toContain('clippy-postgres-data-longhorn')
  })
})
