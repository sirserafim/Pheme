# Versions and compatibility evidence

Checked on 2026-10-05 (UTC) against the official registries and release data linked below.
These versions are pinned on purpose: re-verify them before changing any of them (see
[Update policy](#update-policy)). Exact transitive versions are in `package-lock.json`.

## Runtime

| Item | Exact version | Source |
|---|---|---|
| Node.js | 24.21.0 LTS "Krypton", released 2026-09-07, bundles npm 11.19.0 and V8 13.6.233.17 | [dist index](https://nodejs.org/dist/index.json), [releases](https://nodejs.org/en/about/previous-releases), [schedule](https://github.com/nodejs/Release) |
| PostgreSQL | 18.6 (major 18 supported until 2030-11-14) | [versioning policy](https://www.postgresql.org/support/versioning/) |
| Docker image | `postgres:18.6-trixie@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722` | [Docker Official Image](https://hub.docker.com/_/postgres) |

**Node.js**
- 24.21.0 was the newest 24.x on the check date. The newest 24.x release marked as a security
  release is 24.18.1 (2026-07-28), and 24.21.0 comes after it.
- Node 24 enters Maintenance LTS on 2026-10-20 and reaches end of life on 2028-04-30. The project
  stays on 24 because `AGENTS.md` sets that baseline.
- `.nvmrc` holds `24.21.0`. Both `package.json` files declare `"node": ">=24.21.0 <25"`, and
  `.npmrc` sets `engine-strict=true`. The minimum is the version actually tested. Running `npm ci`
  with Node 24.15.0 fails with `EBADENGINE`.
- Local checks used the official portable build at `C:\dev\.tools\node-v24.21.0-win-x64`, outside
  the repository, without changing the installed Node. The SHA-256 of `node-v24.21.0-win-x64.zip`
  is `158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`, which matches
  [SHASUMS256.txt](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt). The GPG signature of that file
  was **not** verified because GPG is not installed. CI uses `actions/setup-node` with
  `node-version-file: .nvmrc`.

**PostgreSQL image**
- The digest is the multi-architecture index digest reported by
  `docker buildx imagetools inspect postgres:18.6-trixie`.
- Debian trixie rather than Alpine: Alpine's musl C library handles locales and collation
  differently from the glibc builds most PostgreSQL installations use.
- Volume path, from `docker image inspect`: the image declares `VOLUME /var/lib/postgresql` and
  sets `PGDATA=/var/lib/postgresql/18/docker` and `PG_VERSION=18.6-1.pgdg13+2`. This changed in
  PostgreSQL 18 images; older guides mount `/var/lib/postgresql/data`, which these images no longer
  use. The running container reports `SHOW data_directory` = `/var/lib/postgresql/18/docker`.
- The same reference appears in `compose.yaml` and `server/test/support/postgres-image.ts`. A unit
  test fails if they differ.

## npm packages

All versions are exact (`save-exact=true`). "Published" is the registry timestamp for that
version. Every version was the `latest` dist-tag on the check date, except `@types/node`, whose
`latest` tracks Node 26. For Node 24 it stays on 24.x.

| Package | Version | Where | Published | `engines.node` |
|---|---|---|---|---|
| typescript | 7.0.2 | server dev | 2026-07-08 | >=16.20.0 |
| tsx | 4.23.15 | server dev | 2026-09-20 | >=18.0.0 |
| vitest | 5.0.3 | server dev | 2026-09-30 | ^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0 |
| vite (peer of vitest, via lockfile) | 8.3.2 | transitive | 2026-10-01 | ^20.19.0 \|\| >=22.12.0 |
| @biomejs/biome | 2.5.15 | root dev | 2026-09-30 | >=14.21.3 |
| @testcontainers/postgresql | 12.2.0 | server dev | 2026-09-28 | not declared |
| @types/node | 24.19.1 | server dev | 2026-10-01 | not declared |
| @types/pg | 8.23.1 | server dev | 2026-08-17 | not declared |
| pg | 8.23.1 | server | 2026-09-30 | >= 16.0.0 |
| pino | 10.4.0 | server | 2026-10-02 | not declared |
| zod | 4.6.5 | server | 2026-09-13 | not declared |

Other transitive versions worth knowing are esbuild 0.28.2 (used by tsx and vite) and rolldown
1.2.12 (used by vite).

**Native binaries.** TypeScript 7, esbuild, rolldown, Biome and lightningcss ship one package per
platform. The lockfile was generated on Windows but also lists `@typescript/typescript-linux-x64`,
`@esbuild/linux-x64`, `@rolldown/binding-linux-x64-gnu`, `@biomejs/cli-linux-x64` and
`lightningcss-linux-x64-gnu`, among others. That is what lets `npm ci` succeed on Linux CI without
regenerating it.

**Not added, and why:**
- `dotenv`: Node's `--env-file-if-exists` flag loads `.env`. It has not been experimental since
  v24.10.0 ([CLI docs](https://nodejs.org/docs/v24.21.0/api/cli.html#--env-file-if-existsfile)).
- `pino-pretty`: JSON logs are enough for Phase 0.
- An ORM: `AGENTS.md` asks for `pg` and plain SQL migrations.
- The base `testcontainers` package: `@testcontainers/postgresql` brings it in as a dependency,
  and the tests do not import it directly.
- A second TypeScript version: not needed (see below).

## TypeScript 7 compatibility

TypeScript 7.0 is the native compiler and ships no JavaScript compiler API
([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)). Tools that
`import 'typescript'` at runtime would need TypeScript 6 installed alongside it. The tools used here
do not:
- tsx transpiles with esbuild.
- Vitest transpiles through Vite and rolldown.
- Biome is a Rust binary.

Evidence on Windows with Node 24.21.0:

| Check | Result |
|---|---|
| `npm ls typescript --all` | only `@pheme/server` → `typescript@7.0.2`; nothing else depends on it |
| `tsc -p tsconfig.json` (the `typecheck` script) | exit 0 |
| `tsc -p tsconfig.json --skipLibCheck false` (also type-checks every dependency's `.d.ts`) | exit 0 |
| `tsc -p tsconfig.json --noUncheckedIndexedAccess false` | exit 1, TS2578 at `test/types/compiler-flags.ts(5,1)` |
| `tsc -p tsconfig.json --exactOptionalPropertyTypes false` | exit 1, TS2578 at `test/types/compiler-flags.ts(11,1)` |
| tsx runs `dev`, Vitest runs all tests, Biome lints | all succeed with only TypeScript 7 installed |

The last two rows show that `test/types/compiler-flags.ts` guards the two strictness flags. Each
`@ts-expect-error` becomes unused, and therefore an error, if its flag is switched off.

TypeScript 7 adopts the TypeScript 6.0 defaults. One of them matters here: `types` now defaults to
`[]`, so `server/tsconfig.json` lists `"node"` explicitly.

**Fallback.** The plan was to switch to `typescript@6.0.3` if any check failed. None did, so the
fallback was not used. Phase 8 (Angular) will need its own TypeScript 6 in the `web` workspace,
because Angular 22.0.x requires TypeScript `>=6.0 <6.1`
([Angular versions](https://angular.dev/reference/versions)).

Editors may use a different, bundled TypeScript; `npm run typecheck` is the source of truth.

## GitHub Actions

| Action | Release | Pinned commit | Release published | Runtime |
|---|---|---|---|---|
| [actions/checkout](https://github.com/actions/checkout/releases/tag/v7.0.1) | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | 2026-07-20 | node24 |
| [actions/setup-node](https://github.com/actions/setup-node/releases/tag/v7.0.0) | v7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` | 2026-07-14 | node24 |

How each pin was checked:
- `git ls-remote https://github.com/actions/<name> refs/tags/<tag>` returns exactly that commit.
  Both tags point directly at the commit; neither is an annotated tag that would need peeling.
- The GitHub releases API reports `prerelease: false` and `draft: false`.
- The `action.yml` at the pinned commit declares `runs.using: node24`.

CI runs on `ubuntu-24.04` with `permissions: contents: read`, no secrets, and
`persist-credentials: false` on checkout.

## Update policy

- **GitHub Actions** are referenced only by full commit SHA, followed by a version comment. Never
  use tags or branches. Dependabot (`.github/dependabot.yml`) proposes action updates monthly.
  Before merging one, re-run the three checks above for the proposed SHA and read the release
  notes.
- **npm packages** are updated deliberately, in the phase that needs the change, never
  auto-merged. Check the registry's `engines` and `peerDependencies` and the package's official
  docs. Then update with exact versions, commit the regenerated lockfile, run every check, and
  update the tables here. Install with `npm ci` everywhere.
- **PostgreSQL image:** resolve the new tag's index digest with `docker buildx imagetools inspect`
  and re-check `VOLUME`/`PGDATA` with `docker image inspect`. Then update `compose.yaml` and
  `server/test/support/postgres-image.ts` together, and run the integration tests.
- **Node.js:** for a new 24.x patch release, check
  [index.json](https://nodejs.org/dist/index.json) for its `security` flag and bundled npm. Then
  update `.nvmrc` and both `engines` ranges together, and re-run all checks locally and in CI.
