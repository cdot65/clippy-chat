# PostgreSQL local-path to Longhorn

Tracking: [clippy-chat#11](https://github.com/cdot65/clippy-chat/issues/11)

## Storage contract

| Role | Claim | Class | Size | Stage 1 state |
| --- | --- | --- | --- | --- |
| Source | `clippy-postgres-data-clippy-postgres-0` | `local-path` | 10Gi | Authoritative; retained |
| Target | `clippy-postgres-data-longhorn` | `longhorn-replicated` | 10Gi | Empty; unconsumed |

The source PV must retain reclaim policy `Retain`. Preserve the source PVC/PV until target
validation and an explicit decommission decision. Never file-copy a running PostgreSQL data
directory; transfer with `pg_dump` and `pg_restore` while application writers are stopped.

## Review and execution boundary

Stage 1 only creates the target claim and CI contract. It does not authorize a live copy or
consumer switch. Stage 2 will contain the immutable StatefulSet replacement, exact node affinity,
copy/validation commands, and write-safe rollback.

Before any Stage 2 execution:

- obtain explicit operator authorization;
- pause and prove paused both Argo CD Applications, parent `root` first and child `clippy-chat`;
- record each Application's exact automated sync policy for later restoration;
- prove no Argo operation is active;
- stop and prove stopped every application writer before backup or restore;
- capture source/target identity, PostgreSQL version, schema inventory, and relation counts.

Restore Argo in reverse order, child then parent, to the exact captured policies. Existing unrelated
`root` drift is not evidence that the Clippy migration failed.

## Stage 1 verification

```bash
npm test -- k8s/storage.contract.test.ts
kubectl apply --dry-run=client --validate=false \
  -f k8s/10-postgres.yaml \
  -f k8s/11-postgres-longhorn-pvc.yaml \
  -o name
```

These commands render locally. Do not hand-apply the target from a review checkout.
