#!/usr/bin/env bash
# Fails if npm ci (or any earlier step) changed a tracked package.json or package-lock.json.
# node_modules/.package-lock.json is untracked and is ignored on purpose.
set -euo pipefail

status="$(git status --porcelain --untracked-files=all -- ':(glob)**/package.json' ':(glob)**/package-lock.json')"
if [ -n "${status}" ]; then
  echo "tracked package manifests or lockfile changed after npm ci:"
  echo "${status}"
  git --no-pager diff -- ':(glob)**/package.json' ':(glob)**/package-lock.json'
  exit 1
fi
echo "tracked package.json and package-lock.json unchanged after npm ci"
