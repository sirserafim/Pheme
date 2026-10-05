#!/usr/bin/env bash
# Writes which commit a CI job actually tested to the job summary.
# push runs test the pushed commit itself. pull_request runs test GitHub's temporary merge of
# the PR head into the base branch, which is a different SHA from the PR head.
set -euo pipefail

tested_sha="$(git rev-parse HEAD)"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

{
  echo "### Commit under test (${GITHUB_JOB:-job})"
  echo "- Event: \`${GITHUB_EVENT_NAME:-unknown}\`"
  echo "- Tested SHA: \`${tested_sha}\`"
  if [ -n "${PR_HEAD_SHA:-}" ]; then
    echo "- PR head SHA: \`${PR_HEAD_SHA}\`"
    echo "- PR base SHA: \`${PR_BASE_SHA:-unknown}\`"
    head_tree="$(git rev-parse "${PR_HEAD_SHA}^{tree}" 2>/dev/null || echo unavailable)"
    if [ "$(git rev-parse 'HEAD^{tree}')" = "${head_tree}" ]; then
      echo "- The merge result has the same file tree as the PR head."
    else
      echo "- The merge result differs from the PR head (the base branch has changes the head lacks)."
    fi
  fi
} | tee -a "${summary}"
