# PostgreSQL local-path to Longhorn

Tracking: [clippy-chat#11](https://github.com/cdot65/clippy-chat/issues/11)

This is an operator-run cutover. Review commands first; run them from the repository root in one
Bash shell. Never paste secret values into the shell or artifacts.

## Storage contract

| Role | Claim | Class | Size |
| --- | --- | --- | --- |
| Source | `clippy-postgres-data-clippy-postgres-0` | `local-path` | 10Gi |
| Target | `clippy-postgres-data-longhorn` | `longhorn-replicated` | 10Gi |

The source remains authoritative until target restore validation passes. Its PV reclaim policy must
be `Retain`; preserve both source PVC and PV after cutover. The target StatefulSet has no
`volumeClaimTemplates`: replacing that immutable shape requires scale-to-zero, delete, and recreate.

## 1. Prepare and prove preconditions

Stage 1 must already be merged, Argo-synced, and the empty target Bound. Set the approved Stage 2 PR
number, then capture local, Git, Argo, PVC, PV, node, and replica state.

```bash
set -euo pipefail
umask 077

cutover_pr="${CUTOVER_PR:?export CUTOVER_PR to the approved Stage 2 PR number}"
run_id="$(date -u +%Y%m%dT%H%M%SZ)"
repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"
artifact_dir="$(dirname "${repo_root}")/clippy-postgres-cutover-${run_id}"
test ! -e "${artifact_dir}"
mkdir -m 0700 "${artifact_dir}"

test -z "$(git status --porcelain)"
git fetch origin main
pre_cutover_sha="$(git rev-parse origin/main)"
git show "${pre_cutover_sha}:k8s/10-postgres.yaml" > \
  "${artifact_dir}/10-postgres-source.yaml"
git show "${pre_cutover_sha}:k8s/11-postgres-longhorn-pvc.yaml" >/dev/null
printf '%s\n' "${pre_cutover_sha}" > "${artifact_dir}/pre-cutover-sha"
kubectl config current-context > "${artifact_dir}/kube-context"

gh pr edit "${cutover_pr}" --base main
gh pr checks "${cutover_pr}" --watch --fail-fast
gh pr view "${cutover_pr}" --json number,state,baseRefName,headRefName,mergeStateStatus,url > \
  "${artifact_dir}/cutover-pr.json"
jq -e '.state == "OPEN" and .baseRefName == "main"' \
  "${artifact_dir}/cutover-pr.json"

kubectl -n argocd get application root -o json > "${artifact_dir}/root.before.json"
kubectl -n argocd get application clippy-chat -o json > \
  "${artifact_dir}/clippy-chat.before.json"
jq -e '.operation == null and .spec.syncPolicy.automated != null and
  .metadata.annotations["argocd.argoproj.io/skip-reconcile"] == null' \
  "${artifact_dir}/root.before.json"
jq -e '.operation == null and .spec.syncPolicy.automated != null and
  .metadata.annotations["argocd.argoproj.io/skip-reconcile"] == null and
  .status.sync.status == "Synced" and .status.health.status == "Healthy"' \
  "${artifact_dir}/clippy-chat.before.json"

kubectl -n clippy get pvc clippy-postgres-data-clippy-postgres-0 -o json > \
  "${artifact_dir}/source-pvc.before.json"
kubectl -n clippy get pvc clippy-postgres-data-longhorn -o json > \
  "${artifact_dir}/target-pvc.before.json"
jq -e '.status.phase == "Bound" and .spec.storageClassName == "local-path" and
  .status.capacity.storage == "10Gi"' "${artifact_dir}/source-pvc.before.json"
jq -e '.status.phase == "Bound" and .spec.storageClassName == "longhorn-replicated" and
  .status.capacity.storage == "10Gi"' "${artifact_dir}/target-pvc.before.json"

source_pv="$(jq -r '.spec.volumeName' "${artifact_dir}/source-pvc.before.json")"
target_pv="$(jq -r '.spec.volumeName' "${artifact_dir}/target-pvc.before.json")"
test "${source_pv}" != "${target_pv}"
kubectl get pv "${source_pv}" -o json > "${artifact_dir}/source-pv.before.json"
jq -e '.spec.persistentVolumeReclaimPolicy == "Retain"' \
  "${artifact_dir}/source-pv.before.json"
kubectl -n longhorn-system get volumes.longhorn.io "${target_pv}" -o json > \
  "${artifact_dir}/target-longhorn.before.json"
jq -e '.status.robustness == "healthy" and .spec.numberOfReplicas == 3' \
  "${artifact_dir}/target-longhorn.before.json"

kubectl get nodes talos1 talos2 talos3 talos4 talos7 -o wide > \
  "${artifact_dir}/allowed-nodes.before.txt"
kubectl -n clippy get deployment clippy-chat -o json > \
  "${artifact_dir}/clippy-chat-deployment.before.json"
app_replicas="$(jq -r '.spec.replicas' \
  "${artifact_dir}/clippy-chat-deployment.before.json")"
test "${app_replicas}" -gt 0
printf '%s\n' "${app_replicas}" > "${artifact_dir}/app-replicas"
```

Stop if any assertion fails. Existing unrelated `root` OutOfSync resources are allowed; capture
them, but do not treat them as Clippy success or failure.

## 2. Pause and prove paused

Pause parent first, then child. Prove skip-reconcile, automated sync removal, and no active operation
before scaling, copying, or merging anything.

```bash
kubectl -n argocd annotate application root \
  argocd.argoproj.io/skip-reconcile=true --overwrite
kubectl -n argocd patch application root --type merge \
  -p '{"spec":{"syncPolicy":{"automated":null}}}'
kubectl -n argocd get application root -o json | jq -e '
  .metadata.annotations["argocd.argoproj.io/skip-reconcile"] == "true" and
  .spec.syncPolicy.automated == null and .operation == null'

kubectl -n argocd annotate application clippy-chat \
  argocd.argoproj.io/skip-reconcile=true --overwrite
kubectl -n argocd patch application clippy-chat --type merge \
  -p '{"spec":{"syncPolicy":{"automated":null}}}'
kubectl -n argocd get application clippy-chat -o json | jq -e '
  .metadata.annotations["argocd.argoproj.io/skip-reconcile"] == "true" and
  .spec.syncPolicy.automated == null and .operation == null'
```

## 3. Stop writers; dump authoritative source

`deployment/clippy-chat` is the database writer. Stop it and prove zero pods/connections before the
dump. PostgreSQL stays on the source claim for this section.

```bash
kubectl -n clippy scale deployment clippy-chat --replicas=0
kubectl -n clippy rollout status deployment/clippy-chat --timeout=180s
kubectl -n clippy get deployment clippy-chat -o json | jq -e '
  .spec.replicas == 0 and (.status.replicas // 0) == 0'
test "$(kubectl -n clippy get pods -l app=clippy-chat --no-headers 2>/dev/null | wc -l | tr -d ' ')" = 0

source_pod="$(kubectl -n clippy get pods -l app=clippy-postgres \
  -o jsonpath='{.items[0].metadata.name}')"
kubectl -n clippy wait --for=condition=Ready "pod/${source_pod}" --timeout=180s
kubectl -n clippy exec "${source_pod}" -- sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
  "SHOW server_version"' > "${artifact_dir}/source-version.txt"
kubectl -n clippy exec "${source_pod}" -- sh -c \
  'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
  "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"' \
  | grep -qx '0'

kubectl -n clippy exec -i "${source_pod}" -- sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F ","' \
  > "${artifact_dir}/source-counts.csv" <<'SQL'
SELECT format(
  'SELECT %L AS relation, count(*)::bigint AS row_count FROM %I.%I;',
  schemaname || '.' || tablename, schemaname, tablename
)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename
\gexec
SQL

kubectl -n clippy exec "${source_pod}" -- sh -c \
  'exec pg_dump -Fc --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "${artifact_dir}/source.dump"
test -s "${artifact_dir}/source.dump"
kubectl -n clippy exec -i "${source_pod}" -- pg_restore --list \
  < "${artifact_dir}/source.dump" > "${artifact_dir}/source.dump.list"
test -s "${artifact_dir}/source.dump.list"
shasum -a 256 "${artifact_dir}/source.dump" > "${artifact_dir}/source.dump.sha256"
shasum -a 256 -c "${artifact_dir}/source.dump.sha256"
```

## 4. Merge reviewed desired state; replace immutable StatefulSet

Stop again for explicit authorization. Only the authorized operator merges. Keep Argo paused and the
application at zero replicas.

```bash
gh pr merge "${cutover_pr}" --merge
cutover_sha="$(gh pr view "${cutover_pr}" --json mergeCommit --jq '.mergeCommit.oid')"
test -n "${cutover_sha}"
printf '%s\n' "${cutover_sha}" > "${artifact_dir}/cutover-sha"
git fetch origin main
git merge-base --is-ancestor "${cutover_sha}" origin/main
git switch --detach "${cutover_sha}"

npm test -- k8s/storage.contract.test.ts
kubectl apply --dry-run=client --validate=false \
  -f k8s/10-postgres.yaml -f k8s/11-postgres-longhorn-pvc.yaml -o name

kubectl -n clippy scale statefulset clippy-postgres --replicas=0
kubectl -n clippy rollout status statefulset/clippy-postgres --timeout=180s
kubectl -n clippy delete statefulset clippy-postgres --wait=true
kubectl -n clippy get pvc clippy-postgres-data-clippy-postgres-0 >/dev/null
kubectl apply -f k8s/10-postgres.yaml
kubectl -n clippy rollout status statefulset/clippy-postgres --timeout=300s

target_pod="$(kubectl -n clippy get pods -l app=clippy-postgres \
  -o jsonpath='{.items[0].metadata.name}')"
kubectl -n clippy get pod "${target_pod}" -o json | jq -e \
  --argjson allowed '["talos1","talos2","talos3","talos4","talos7"]' '
  .spec.nodeName as $node |
  (($allowed | index($node)) != null) and
  any(.spec.volumes[];
    .name == "clippy-postgres-data" and
    .persistentVolumeClaim.claimName == "clippy-postgres-data-longhorn")'
```

The source PVC still existing is a hard gate. Do not continue if Kubernetes selected any other
claim or hostname.

## 5. Restore and validate before writes

Stream the custom dump into target PostgreSQL. Compare every non-system table count before starting
the application.

```bash
kubectl -n clippy exec -i "${target_pod}" -- sh -c '
  exec pg_restore --clean --if-exists --exit-on-error --no-owner --no-privileges \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB"
' < "${artifact_dir}/source.dump"

kubectl -n clippy exec -i "${target_pod}" -- sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F ","' \
  > "${artifact_dir}/target-counts.csv" <<'SQL'
SELECT format(
  'SELECT %L AS relation, count(*)::bigint AS row_count FROM %I.%I;',
  schemaname || '.' || tablename, schemaname, tablename
)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename
\gexec
SQL

diff -u "${artifact_dir}/source-counts.csv" "${artifact_dir}/target-counts.csv"
kubectl -n clippy exec "${target_pod}" -- sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
  "SHOW server_version"' > "${artifact_dir}/target-version.txt"
diff -u "${artifact_dir}/source-version.txt" "${artifact_dir}/target-version.txt"
kubectl -n clippy exec "${target_pod}" -- sh -c \
  'exec pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
kubectl -n longhorn-system get volumes.longhorn.io "${target_pv}" -o json | jq -e '
  .status.robustness == "healthy" and .spec.numberOfReplicas == 3'

date -u +%Y-%m-%dT%H:%M:%SZ > "${artifact_dir}/target-writes-started"
kubectl -n clippy scale deployment clippy-chat --replicas="${app_replicas}"
kubectl -n clippy rollout status deployment/clippy-chat --timeout=300s
curl --fail --silent --show-error https://clippy.cdot.io/login >/dev/null
```

The marker is written before scale-up: once it exists, assume target writes occurred even if rollout
or smoke validation fails.

## 6. Restore exact Argo policy

Only restore after the chosen live shape matches `origin/main`. Restore child, then parent. Patch the
exact captured automated policy while each Application remains skipped, then remove skip-reconcile.

```bash
git fetch origin main
desired_sha="${desired_sha:-${cutover_sha}}"
test "$(git rev-parse origin/main)" = "${desired_sha}"
child_policy_snapshot="${child_policy_snapshot:-${artifact_dir}/clippy-chat.before.json}"
root_policy_snapshot="${root_policy_snapshot:-${artifact_dir}/root.before.json}"

child_automated="$(jq -c '.spec.syncPolicy.automated' \
  "${child_policy_snapshot}")"
child_patch="$(jq -cn --argjson automated "${child_automated}" \
  '{spec:{syncPolicy:{automated:$automated}}}')"
kubectl -n argocd patch application clippy-chat --type merge -p "${child_patch}"
diff -u \
  <(jq -S '.spec.syncPolicy.automated' "${child_policy_snapshot}") \
  <(kubectl -n argocd get application clippy-chat -o json | jq -S '.spec.syncPolicy.automated')
kubectl -n argocd annotate application clippy-chat \
  argocd.argoproj.io/skip-reconcile-

root_automated="$(jq -c '.spec.syncPolicy.automated' "${root_policy_snapshot}")"
root_patch="$(jq -cn --argjson automated "${root_automated}" \
  '{spec:{syncPolicy:{automated:$automated}}}')"
kubectl -n argocd patch application root --type merge -p "${root_patch}"
diff -u \
  <(jq -S '.spec.syncPolicy.automated' "${root_policy_snapshot}") \
  <(kubectl -n argocd get application root -o json | jq -S '.spec.syncPolicy.automated')
kubectl -n argocd annotate application root argocd.argoproj.io/skip-reconcile-

kubectl -n argocd annotate application clippy-chat \
  argocd.argoproj.io/refresh=hard --overwrite
for attempt in {1..60}; do
  if kubectl -n argocd get application clippy-chat -o json | jq -e \
    --arg revision "${desired_sha}" '
    .status.sync.revision == $revision and .status.sync.status == "Synced" and
    .status.health.status == "Healthy"' >/dev/null; then
    break
  fi
  test "${attempt}" != 60
  sleep 5
done
kubectl -n argocd get application clippy-chat -o json | jq -e '
  .metadata.annotations["argocd.argoproj.io/skip-reconcile"] == null and
  .spec.syncPolicy.automated != null and .operation == null and
  .status.sync.status == "Synced" and
  .status.health.status == "Healthy"'
kubectl -n clippy get statefulset/clippy-postgres deployment/clippy-chat -o wide
kubectl -n clippy get pvc clippy-postgres-data-clippy-postgres-0 \
  clippy-postgres-data-longhorn -o wide
```

Retain the protected dump, checksums, counts, source PVC, and source PV until a separate authorized
decommission. Do not commit the artifact directory.

## Rollback

Keep both Argo Applications paused throughout rollback. Before restoring Argo, merge a reviewed
revert of the Stage 2 merge so `origin/main:k8s/10-postgres.yaml` again matches the source shape.

### Re-pause after a completed cutover

If Argo was already restored, do not repeat section 1: the PR is merged and `main` contains the
target manifest. Point to the original protected artifact directory. This recovers persisted state,
captures fresh policy snapshots, and re-pauses parent then child before any Git or workload change.

```bash
set -euo pipefail
umask 077

artifact_dir="$(cd "${ROLLBACK_ARTIFACT_DIR:?export the original artifact path}" && pwd)"
test -s "${artifact_dir}/10-postgres-source.yaml"
test -s "${artifact_dir}/source.dump"
test -s "${artifact_dir}/source.dump.sha256"
shasum -a 256 -c "${artifact_dir}/source.dump.sha256"

pre_cutover_sha="$(tr -d '\n' < "${artifact_dir}/pre-cutover-sha")"
cutover_sha="$(tr -d '\n' < "${artifact_dir}/cutover-sha")"
app_replicas="$(tr -d '\n' < "${artifact_dir}/app-replicas")"
target_pv="$(jq -r '.spec.volumeName' "${artifact_dir}/target-pvc.before.json")"
test "${#pre_cutover_sha}" -eq 40
test "${#cutover_sha}" -eq 40
test "${app_replicas}" -gt 0
test -n "${target_pv}"

rollback_id="$(date -u +%Y%m%dT%H%M%SZ)"
rollback_state_dir="${artifact_dir}/rollback-${rollback_id}"
mkdir -m 0700 "${rollback_state_dir}"
root_policy_snapshot="${rollback_state_dir}/root.before.json"
child_policy_snapshot="${rollback_state_dir}/clippy-chat.before.json"

kubectl -n argocd get application root -o json > "${root_policy_snapshot}"
kubectl -n argocd get application clippy-chat -o json > "${child_policy_snapshot}"
jq -e '.operation == null and .spec.syncPolicy.automated != null and
  .metadata.annotations["argocd.argoproj.io/skip-reconcile"] == null' \
  "${root_policy_snapshot}"
jq -e '.operation == null and .spec.syncPolicy.automated != null and
  .metadata.annotations["argocd.argoproj.io/skip-reconcile"] == null and
  .status.sync.status == "Synced" and .status.health.status == "Healthy"' \
  "${child_policy_snapshot}"

kubectl -n clippy get pvc clippy-postgres-data-clippy-postgres-0 >/dev/null
kubectl -n clippy get statefulset clippy-postgres -o json | jq -e '
  .spec.volumeClaimTemplates == null and
  any(.spec.template.spec.volumes[];
    .persistentVolumeClaim.claimName == "clippy-postgres-data-longhorn")'

kubectl -n argocd annotate application root \
  argocd.argoproj.io/skip-reconcile=true --overwrite
kubectl -n argocd patch application root --type merge \
  -p '{"spec":{"syncPolicy":{"automated":null}}}'
kubectl -n argocd get application root -o json | jq -e '
  .metadata.annotations["argocd.argoproj.io/skip-reconcile"] == "true" and
  .spec.syncPolicy.automated == null and .operation == null'

kubectl -n argocd annotate application clippy-chat \
  argocd.argoproj.io/skip-reconcile=true --overwrite
kubectl -n argocd patch application clippy-chat --type merge \
  -p '{"spec":{"syncPolicy":{"automated":null}}}'
kubectl -n argocd get application clippy-chat -o json | jq -e '
  .metadata.annotations["argocd.argoproj.io/skip-reconcile"] == "true" and
  .spec.syncPolicy.automated == null and .operation == null'
```

The `root_policy_snapshot` and `child_policy_snapshot` variables make section 6 restore these fresh
policies. Keep this shell open.

### Abort before Stage 2 merge

If the PR is still open, Git and PostgreSQL remain on the source shape. Restart the application,
set the desired revision to the captured pre-cutover SHA, then use section 6; no revert is needed.

```bash
gh pr view "${cutover_pr}" --json state --jq '.state' | grep -qx OPEN
kubectl -n clippy rollout status statefulset/clippy-postgres --timeout=180s
kubectl -n clippy scale deployment clippy-chat --replicas="${app_replicas}"
kubectl -n clippy rollout status deployment/clippy-chat --timeout=300s
curl --fail --silent --show-error https://clippy.cdot.io/login >/dev/null
desired_sha="${pre_cutover_sha}"
```

For any rollback after merge, first restore the Git desired state:

```bash
git fetch origin main
rollback_branch="cdot65/rollback-clippy-postgres-${cutover_sha:0:7}"
git switch -c "${rollback_branch}" origin/main
git revert -m 1 "${cutover_sha}"
git push -u origin "${rollback_branch}"
gh pr create --base main --head "${rollback_branch}" \
  --title 'rollback: restore Clippy PostgreSQL local-path consumer' \
  --body 'Emergency rollback for clippy-chat#11. Argo remains paused.'
```

Obtain explicit merge authorization; do not restore Argo until that rollback PR is merged.
After merge, prove Git desired state matches the captured source manifest:

```bash
git fetch origin main
git show origin/main:k8s/10-postgres.yaml | \
  diff -u "${artifact_dir}/10-postgres-source.yaml" -
desired_sha="$(git rev-parse origin/main)"
```

### Before target writes

If `target-writes-started` does not exist, the source is still authoritative. Recreate the source
shape and start the application only after source readiness.

```bash
test ! -e "${artifact_dir}/target-writes-started"
kubectl -n clippy scale deployment clippy-chat --replicas=0
kubectl -n clippy rollout status deployment/clippy-chat --timeout=180s
kubectl -n clippy get deployment clippy-chat -o json | jq -e '
  .spec.replicas == 0 and (.status.replicas // 0) == 0'
test "$(kubectl -n clippy get pods -l app=clippy-chat --no-headers 2>/dev/null | wc -l | tr -d ' ')" = 0
kubectl -n clippy scale statefulset clippy-postgres --replicas=0
kubectl -n clippy rollout status statefulset/clippy-postgres --timeout=180s
kubectl -n clippy delete statefulset clippy-postgres --wait=true
kubectl apply -f "${artifact_dir}/10-postgres-source.yaml"
kubectl -n clippy rollout status statefulset/clippy-postgres --timeout=300s
kubectl -n clippy get pod -l app=clippy-postgres -o json | jq -e '
  (.items | length) == 1 and
  any(.items[0].spec.volumes[];
    .persistentVolumeClaim.claimName == "clippy-postgres-data-clippy-postgres-0")'
source_pod="$(kubectl -n clippy get pods -l app=clippy-postgres \
  -o jsonpath='{.items[0].metadata.name}')"
kubectl -n clippy exec -i "${source_pod}" -- sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F ","' \
  > "${artifact_dir}/source-rollback-counts.csv" <<'SQL'
SELECT format(
  'SELECT %L AS relation, count(*)::bigint AS row_count FROM %I.%I;',
  schemaname || '.' || tablename, schemaname, tablename
)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename
\gexec
SQL

diff -u "${artifact_dir}/source-counts.csv" \
  "${artifact_dir}/source-rollback-counts.csv"
kubectl -n clippy scale deployment clippy-chat --replicas="${app_replicas}"
kubectl -n clippy rollout status deployment/clippy-chat --timeout=300s
curl --fail --silent --show-error https://clippy.cdot.io/login >/dev/null
```

Then use section 6 to restore exact Argo policy after the rollback merge is present on `main`.

### After target writes

Never blindly return to the stale source. Stop/prove stopped writers, take a final target dump, then
restore that target state into the preserved source before restarting the application.

```bash
test -e "${artifact_dir}/target-writes-started"
kubectl -n clippy scale deployment clippy-chat --replicas=0
kubectl -n clippy rollout status deployment/clippy-chat --timeout=180s
kubectl -n clippy get deployment clippy-chat -o json | jq -e '
  .spec.replicas == 0 and (.status.replicas // 0) == 0'
test "$(kubectl -n clippy get pods -l app=clippy-chat --no-headers 2>/dev/null | wc -l | tr -d ' ')" = 0

target_pod="$(kubectl -n clippy get pods -l app=clippy-postgres \
  -o jsonpath='{.items[0].metadata.name}')"
kubectl -n clippy exec "${target_pod}" -- sh -c \
  'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
  "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"' \
  | grep -qx '0'
kubectl -n clippy exec -i "${target_pod}" -- sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F ","' \
  > "${artifact_dir}/target-final-counts.csv" <<'SQL'
SELECT format(
  'SELECT %L AS relation, count(*)::bigint AS row_count FROM %I.%I;',
  schemaname || '.' || tablename, schemaname, tablename
)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename
\gexec
SQL

kubectl -n clippy exec "${target_pod}" -- sh -c \
  'exec pg_dump -Fc --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "${artifact_dir}/target-final.dump"
test -s "${artifact_dir}/target-final.dump"
kubectl -n clippy exec -i "${target_pod}" -- pg_restore --list \
  < "${artifact_dir}/target-final.dump" > "${artifact_dir}/target-final.dump.list"
test -s "${artifact_dir}/target-final.dump.list"
shasum -a 256 "${artifact_dir}/target-final.dump" > \
  "${artifact_dir}/target-final.dump.sha256"
shasum -a 256 -c "${artifact_dir}/target-final.dump.sha256"

kubectl -n clippy scale statefulset clippy-postgres --replicas=0
kubectl -n clippy rollout status statefulset/clippy-postgres --timeout=180s
kubectl -n clippy delete statefulset clippy-postgres --wait=true
kubectl apply -f "${artifact_dir}/10-postgres-source.yaml"
kubectl -n clippy rollout status statefulset/clippy-postgres --timeout=300s
kubectl -n clippy get pod -l app=clippy-postgres -o json | jq -e '
  (.items | length) == 1 and
  any(.items[0].spec.volumes[];
    .persistentVolumeClaim.claimName == "clippy-postgres-data-clippy-postgres-0")'
source_pod="$(kubectl -n clippy get pods -l app=clippy-postgres \
  -o jsonpath='{.items[0].metadata.name}')"
kubectl -n clippy exec -i "${source_pod}" -- sh -c '
  exec pg_restore --clean --if-exists --exit-on-error --no-owner --no-privileges \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB"
' < "${artifact_dir}/target-final.dump"

kubectl -n clippy exec -i "${source_pod}" -- sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F ","' \
  > "${artifact_dir}/source-restored-counts.csv" <<'SQL'
SELECT format(
  'SELECT %L AS relation, count(*)::bigint AS row_count FROM %I.%I;',
  schemaname || '.' || tablename, schemaname, tablename
)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename
\gexec
SQL

diff -u "${artifact_dir}/target-final-counts.csv" \
  "${artifact_dir}/source-restored-counts.csv"

kubectl -n clippy scale deployment clippy-chat --replicas="${app_replicas}"
kubectl -n clippy rollout status deployment/clippy-chat --timeout=300s
curl --fail --silent --show-error https://clippy.cdot.io/login >/dev/null
```

Merge the rollback PR, then use section 6. Preserve both claims and both dumps until the incident
is closed.
