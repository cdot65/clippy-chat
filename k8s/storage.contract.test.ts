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
  it('provides the 10Gi Longhorn target claim', () => {
    const target = resource(
      './11-postgres-longhorn-pvc.yaml',
      'PersistentVolumeClaim',
      'clippy-postgres-data-longhorn',
    )

    expect(target.metadata.namespace).toBe('clippy')
    expect(target.spec.accessModes).toEqual(['ReadWriteOnce'])
    expect(target.spec.storageClassName).toBe('longhorn-replicated')
    expect(target.spec.resources.requests.storage).toBe('10Gi')

  })

  it('mounts the explicit target without a volume claim template', () => {
    const postgres = resource('./10-postgres.yaml', 'StatefulSet', 'clippy-postgres')

    expect(postgres.spec).not.toHaveProperty('volumeClaimTemplates')

    const dataVolume = postgres.spec.template.spec.volumes?.find(
      (volume: Manifest) => volume.name === 'clippy-postgres-data',
    )
    expect(dataVolume?.persistentVolumeClaim?.claimName)
      .toBe('clippy-postgres-data-longhorn')

    const postgresContainer = postgres.spec.template.spec.containers.find(
      (container: Manifest) => container.name === 'postgres',
    )
    const dataMount = postgresContainer.volumeMounts?.find(
      (mount: Manifest) => mount.name === 'clippy-postgres-data',
    )
    expect(dataMount).toMatchObject({
      mountPath: '/var/lib/postgresql/data',
      subPath: 'pgdata',
    })
  })

  it('requires the exact bare-metal hostname set', () => {
    const postgres = resource('./10-postgres.yaml', 'StatefulSet', 'clippy-postgres')
    const terms = postgres.spec.template.spec.affinity?.nodeAffinity
      ?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms
    expect(terms).toHaveLength(1)
    expect(terms[0].matchExpressions).toHaveLength(1)
    expect(terms[0].matchExpressions[0]).toEqual({
      key: 'kubernetes.io/hostname',
      operator: 'In',
      values: ['talos1', 'talos2', 'talos3', 'talos4', 'talos7'],
    })
  })
})
