# Phase 0 evidence

Recorded 2026-10-06 (UTC) on `phase-0-setup`. This file covers the Phase 0 repairs after review of
`be2e092`. Commands, exit codes and counts below are observed output. Unit and integration tests
use synthetic data and throwaway Testcontainers. Compose and Ctrl+C checks used a disposable
project `pheme-verify` on host port 55432, not the developer's `pheme_pgdata` volume and not `.env`.

**Checked code:** `f2de80685270c71d525c166cdaf9a667fbed962b` (tree `29bc7c6dfee3080b1de27c6ba09f5a0d124ed65d`).
The commit that adds this file and README notes changes only Markdown, which Biome does not check,
so the inputs to lint, typecheck and tests are the same tree. CI results for the pushed head SHA
and, if a pull request is opened, GitHub's merge SHA are separate and are not inferred from local
runs.

**Baseline the reviewer used:** `be2e092`. Commits on top of it:

| SHA | Subject |
|---|---|
| `7fbf1fa` | `fix(logging): redact secrets per value and keep JSON valid` |
| `a4a1b34` | `fix(config): reject DATABASE_URL components pg cannot decode` |
| `7d48960` | `fix(dev): end the process when shutdown cannot finish cleanly` |
| `011fc72` | `fix(dev): wait for database sockets to close before reporting shutdown` |
| `38d61d1` | `fix(dev): destroy leftover sockets when shutdown times out` |
| `871d1b5` | `test(integration): wait for process close and keep secrets out of diagnostics` |
| `f2de806` | `ci: fail if npm ci changes tracked package files` |

## Environment

| Item | Value |
|---|---|
| OS / shell | Windows 11 x64 (10.0.26300), Windows PowerShell 5.1 |
| Node / npm | v24.21.0 / 11.19.0, portable build at `C:\dev\.tools\node-v24.21.0-win-x64` |
| Docker | Docker Desktop, Engine 29.4.0, Compose v5.1.1 |
| Linux checks | `node:24.21.0-trixie-slim` (`sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66`), npm 11.19.0 |

npm printed `npm warn Unknown env config "devdir"` on this machine. That comes from a user-level
setting, not from the repository.

## What was reproduced vs reported vs blocked

**Reproduced application defects (on `be2e092`, then fixed):**

1. With `Date.now()` stubbed to `1791245000000` and secret `"17912450"`, `logger.info("startup")`
   wrote invalid JSON (`"time":[REDACTED]00000`). Root cause: the scrubber ran on the finished JSON
   line. Fix: sanitize values in `hooks.logMethod` before pino serializes them.
2. `secretsFromDatabaseUrl("postgres://app:abc1234@127.0.0.1/pheme")` then
   `logger.error(new Error("example boundary included abc1234"))` leaked the password (3 times:
   `msg`, `err.message`, `err.stack`). Root cause: secrets shorter than 8 characters were skipped.
   Fix: every non-empty secret is redacted; the cost is over-masking of the same characters in
   unrelated text.
3. `postgres://%FF:synthetic-password@127.0.0.1/pheme` passed `z.url()` then `describeDatabase()`
   threw `URIError` before the env error handler. Fix: refine the schema with the same decoders
   pg-connection-string uses; `runDev` returns 1 with a sanitized `DATABASE_URL` problem.

**Reproduced shutdown defects (against `runDev` with a stub pool, then against a paused database):**

4. A second SIGINT while `close()` was still pending returned 0 and logged `shutdown complete`
   after `exit(1)` had already been requested. Fix: a `forced` flag; success is logged only when
   close finished and no forced exit happened.
5. `close()` rejecting or hanging returned 1 from `runDev` but did not call `exit(1)`, so open
   handles could keep the process alive. Fix: `exit(1)` on those paths.
6. Pausing the disposable database after `db ok`, then a real Ctrl+C: `pool.end()` resolved and
   the process logged `shutdown complete`, then stayed alive on the open socket (~25 s until the
   helper killed it). Root cause: pg-pool resolves `end()` when it has dropped clients, before the
   TCP sockets close; a timeout race does not cancel those handles. Fix: wait for each connected
   client's `end`, and on deadline/failure call `abandon()` which `destroy()`s leftover streams.
   After that change, the same paused-database Ctrl+C exited 1 in 10669 ms with
   `closing database pool timed out` and no success message.

**Reported symptom that was not an application miss of `shutdown complete`:**

7. At `LOG_LEVEL=info`, one real console Ctrl+C after `db ok` **does** log `shutdown complete` on
   the direct Node process (Windows exit 0, Linux PTY exit 0). The missing completion, when it
   appeared in review, was mixed with wrapper/process-group behaviour and with the hung-socket
   case above.

**Environment / wrapper facts (not treated as application shutdown bugs):**

- Windows `child.kill("SIGINT")` after `db ok`: process exit `code=null`, `signal=SIGINT`, logs
  only `dev starting | db ok`. Node documents that this is `TerminateProcess`, not a console
  interrupt. The Linux integration test still uses `kill('SIGINT')` and is skipped on Windows.
- `npm run dev` after a real Ctrl+C: server logs the full shutdown; **npm** reports 1 on Windows
  (it kills the `cmd.exe` it started) and 130 on Linux (`128+SIGINT`, process group + npm forward).
  A preload probe on Linux showed `main.ts` itself exiting 0.

**Install lockfile change:** not reproduced. See below.

## Install

Disposable clones (no `.env`), Node 24.21.0, npm 11.19.0, project `.npmrc`. No other npm command
was running.

| Where | `npm ci` | `package-lock.json` SHA-256 before | after | git status |
|---|---|---|---|---|
| Windows clean clone | exit 0, 18 s, 242 packages | `79f6b5459f3a299e11f29f64d3fab64eac66690c978da4184f59e50c744a28ec` | same | clean |
| Linux container | exit 0, 5 s, 242 packages | same | same | `package.json` / `server/package.json` hashes also unchanged |

`node_modules/.package-lock.json` is a different, untracked file (present after install). npm 11.19
warns that esbuild, protobufjs and ssh2 have install scripts not in `allowScripts`; that warning
does not rewrite the tracked lockfile. CI now runs
`.github/scripts/check-package-files-unchanged.sh` after `npm ci` in both jobs.

## Checks on `f2de806`

| Command (repository root) | Exit | Result |
|---|---|---|
| `npm run lint` | 0 | `Checked 31 files in 31ms. No fixes applied.` |
| `npm run typecheck` | 0 | no errors |
| `npm run test:unit` | 0 | 7 files, **59 passed** |
| `npm run test:integration` | 0 | 3 files, **11 passed, 1 skipped** (12) |

The skipped test is SIGINT via `child.kill` on Windows. The Linux job is expected to run it.

**Focused reproductions (then passing after the fix):**
- Logging: 6 of 14 new logger tests failed on `be2e092`; the external repro script then reported
  valid JSON (`time=1791245000000`) and 0 occurrences of `abc1234`.
- `DATABASE_URL`: 10 new tests failed with `URIError` / accepted malformed escapes; after the
  refine, `runDev` with `%FF` exits 1, logs `user name is not valid percent-encoded UTF-8`, and
  does not echo the password, `%FF`, or `URIError`.
- Shutdown unit tests: 51 then 54 then 59 as abandon and classifiers were added.

## Ctrl+C and disposable Compose

Project `pheme-verify`, env file outside the repo, port **55432**, synthetic passwords. Clone had
no `.env`. Interrupt was `GenerateConsoleCtrlEvent` (Windows) or PTY `\x03` (Linux `script`).

| Scenario | Result |
|---|---|
| Windows direct `node --import tsx src/main.ts`, Ctrl+C after `db ok` | exit **0** in ~1 s; `dev starting`, `db ok`, `shutdown requested (SIGINT)`, `shutdown complete`; stdout empty |
| Windows `npm run dev` (root and server), same interrupt | npm exit **1**; server still logged the four messages including `shutdown complete` |
| Linux PTY direct node | exit **0**; same four messages |
| Linux PTY `npm run dev` | npm/script exit **130**; server logged `shutdown complete`; `main.ts` probe exit 0 |
| Paused database, then Ctrl+C (after socket destroy) | exit **1** in 10669 ms; `closing database pool timed out`; no `shutdown complete` |
| `docker compose -p pheme-verify up --detach --wait` | exit 0; `pheme-verify-postgres-1` healthy; `127.0.0.1:55432->5432/tcp` |
| `docker compose -p pheme-verify down --volumes` | exit 0; throwaway volume removed |

Synthetic passwords: 0 matches in captured interrupt logs. The developer's Compose volume was not
deleted. `.env` was not overwritten.

## Remaining limits

- Over-masking: a very short registered secret also redacts the same characters in `runId` or other
  text. Numeric fields and bindings are no longer rewritten as JSON syntax.
- `npm run dev` exit codes after Ctrl+C stay wrapper-defined (Windows 1, Linux 130). Use the direct
  `node` command in `server/` for the server's own code.
- Windows automated SIGINT remains skipped; real Ctrl+C was verified separately.
- GPG of Node's `SHASUMS256.txt` is still unverified.
- **CI:** local results do not stand in for GitHub Actions. Push tests this head SHA; a
  `pull_request` run, when present, tests a different merge SHA.

## CI (GitHub Actions)

Queried via the public GitHub API (run and job **conclusions** only; job logs returned 403 without
credentials, so CI test counts are not available here).

**Push** of `32688517e297b7b76304f907727ef130062c2213` (repair code plus the first evidence/README
commit). That is the SHA the jobs below actually tested:

| Item | Value |
|---|---|
| Event | `push` |
| Head SHA tested | `32688517e297b7b76304f907727ef130062c2213` |
| Run | [37504588221](https://github.com/sirserafim/Pheme/actions/runs/37504588221) |
| Run conclusion | **success** |
| Job `Lint, typecheck, unit tests` | success |
| Job `Integration tests and Compose smoke test (Docker)` | success |

CI log bodies were not readable (API 403), so this table does not claim a test count from GitHub.

A later Markdown-only commit on this branch is a different SHA; do not treat run 37504588221 as
having tested that later SHA.

**Pull request merge SHA:** no `pull_request` run exists. There is no open PR for `phase-0-setup`,
so GitHub has not built a merge commit. Do not treat the push result as coverage of a merge SHA.

## Concepts

See the end of the chat report for a short Greek explanation of redaction-before-serialize,
percent-decoding vs schema validation, and process-group signals vs `process.exit`.
