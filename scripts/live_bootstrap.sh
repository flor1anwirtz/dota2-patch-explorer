#!/usr/bin/env bash
# CI-only one-time archive fill. Each validated checkpoint survives interruption.
set -euo pipefail
project=$(git rev-parse --show-toplevel)
rscript=${RSCRIPT:-Rscript}
branch=${GITHUB_REF_NAME:?Run this from the default branch in GitHub Actions}
remote_ref="refs/remotes/origin/$branch"
temp=$(mktemp -d)
tree="$temp/collector"
trap 'git -C "$project" worktree remove --force "$tree" >/dev/null 2>&1 || true; rm -rf -- "$temp"' EXIT
fetch_latest() { git fetch --quiet origin "refs/heads/$branch:$remote_ref"; }
fetch_latest
git worktree add --quiet --detach "$tree" "$remote_ref"
cd "$tree"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
export DOTA_BACKFILL_DAYS=8 DOTA_BATCH_STATUS="$temp/status"
budget=$((4 * 3600))
checkpoints=0

while ((SECONDS < budget)); do
  fetch_latest
  git merge --ff-only "$remote_ref"
  base=$(git rev-parse HEAD)
  if ! timeout "$((budget - SECONDS))s" "$rscript" scripts/live_update.R --bootstrap; then
    echo "::warning::Bootstrap paused. Stored checkpoints remain available; rerun to resume."
    if ((checkpoints == 0)); then exit 1; fi
    break
  fi
  node --test tests/*.cjs
  git add -- data/live/ data/live-patches.csv docs/live-data.js
  if ! git diff --cached --quiet; then
    git commit --quiet -m "Checkpoint historical ranked match counts"
    for attempt in 1 2 3; do
      if git push origin "HEAD:refs/heads/$branch"; then
        checkpoints=$((checkpoints + 1))
        echo "Checkpoint $checkpoints: $(git rev-parse --short HEAD)"
        break
      fi
      # Merge independent day additions by recomputing the derived dashboard
      # from a new detached checkout. Never overwrite another writer's day.
      batch=$(git rev-parse HEAD)
      fetch_latest
      remote=$(git rev-parse "$remote_ref")
      if [[ "$attempt" == 3 || "$remote" == "$base" ]] ||
         ! git merge-base --is-ancestor "$base" "$remote" ||
         ! git diff --quiet "$batch" "$remote" -- data/live-patches.csv ||
         ! git diff --quiet "$base" "$remote" -- scripts/ ||
         ! git diff --quiet --diff-filter=MD "$base" "$batch" -- data/live/; then
        echo "::error::The remote checkpoint could not be updated safely. Rerun to resume."
        exit 1
      fi
      mapfile -t added < <(git diff --name-only --diff-filter=A "$base" "$batch" -- data/live/)
      git switch --quiet --detach "$remote"
      for file in "${added[@]}"; do
        [[ -f "$file" ]] || git restore --source="$batch" --worktree -- "$file"
      done
      git add -- data/live/
      if git diff --cached --quiet; then break; fi
      "$rscript" scripts/live_export.R
      node --test tests/*.cjs
      git add -- docs/live-data.js
      git commit --quiet -m "Merge verified historical day archives"
      base="$remote"
    done
  fi
  state=$(cat "$DOTA_BATCH_STATUS")
  if [[ "$state" == complete ]]; then
    echo "Initial historical archive is complete."
    break
  elif [[ "$state" == blocked ]]; then
    echo "::warning::The upstream source could not supply every requested date. Inspect the run summary before retrying."
    break
  elif [[ "$state" != continue ]]; then
    echo "::error::Unexpected batch status."
    exit 1
  fi
done
if ((SECONDS >= budget)); then echo "::warning::Time budget reached. Rerun bootstrap to resume."; fi
# Package a clean, remotely committed snapshot, including simultaneous contributions.
cd "$project"
fetch_latest
git merge --ff-only "$remote_ref"
