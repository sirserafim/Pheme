# Phase 0 evidence

Recorded 2026-10-05 (UTC) on the `phase-0-setup` branch. Everything below is the observed output of
real commands. Unit and integration results use synthetic test data and throwaway containers. The
local Compose and `dev` runs use the developer's own `.env`, whose values are never printed.

**Commit under test:** `f80e04cf1f8b899333744d0d1a88c052e00c405a`. The commit that adds this file
changes only Markdown (`README.md`, `AGENTS.md`, `PHASES.md` and `docs/`), and Biome does not check
Markdown, so every input to these checks is unchanged. A file cannot contain the SHA of the commit
that adds it, so the CI results for the pushed PR head SHA and GitHub's merge SHA are reported in
the pull request.

## Environment

| Item | Value |
|---|---|
| OS / shell | Windows 11 x64 (10.0.26300), Windows PowerShell 5.1.26100.9549 |
| Node / npm | v24.21.0 / 11.19.0, the portable build at `C:\dev\.tools\node-v24.21.0-win-x64` (zip SHA-256 verified, see [versions.md](../versions.md)) |
| Installed Node | 24.15.0, unchanged; used only for the engines check below |
| Docker | Docker Desktop, Engine 29.4.0, Compose v5.1.1 |

npm printed `npm warn Unknown env config "devdir"` on every command. This comes from a user-level
environment setting on this machine, not from the repository, and does not affect results.

## Install

| Command | Exit | Result |
|---|---|---|
| `npm ci` with installed Node 24.15.0 | 1 | `EBADENGINE`, `Required: {"node":">=24.21.0 <25"}` |
| `node_modules` removed, then `npm ci` with Node 24.21.0 | 0 | 242 packages added in about 27 s |
| `npm ls` | 0 | no missing, invalid or extraneous packages |
| `git status` after install | — | `package-lock.json` unchanged |

The lockfile (version 3) also lists the Linux x64 native packages that CI needs:
`@typescript/typescript-linux-x64`, `@esbuild/linux-x64`, `@rolldown/binding-linux-x64-gnu`,
`@biomejs/cli-linux-x64` and `lightningcss-linux-x64-gnu`, plus their musl variants where they
exist.

## Checks

| Command (repository root) | Exit | Result |
|---|---|---|
| `npm run lint` | 0 | `Checked 26 files in 20ms. No fixes applied.` |
| `npm run typecheck` | 0 | no errors |
| `npm run test:unit` | 0 | 5 files, 22 tests passed |
| `npm run test:integration` | 0 | 3 files, 11 passed, 1 skipped (12) |
| `npm test` (unit, then integration) | 0 | the same two results, in about 18 s |

The TypeScript 7 checks (`--skipLibCheck false`, and switching off each strictness flag) are listed
in [versions.md](../versions.md#typescript-7-compatibility).

**Unit tests** (no Docker, network or API keys):
- `env.test.ts`, 7 tests:
  - defaults and numeric coercion; empty values count as unset
  - only the command's own variables are returned, and no API keys are needed
  - a missing `DATABASE_URL` is reported by name
  - invalid values are reported by name without echoing them
  - a URL without a host is rejected
- `logger.test.ts`, 6 tests:
  - secret-named fields are redacted
  - a secret inside `error.message`, `stack` and `cause` is removed, including the `msg` of
    `logger.error(err)`
  - the same inside an `AggregateError`
  - passwords in URLs that were never registered as secrets are masked
  - only allowlisted error fields are logged
  - every line has `service` and `runId`
- `shutdown.test.ts`, 5 tests:
  - the first signal resolves and later signals count as repeats
  - `dispose` removes the listeners
  - task timeout outcomes: done, failed and timeout
- `dev-command.test.ts`, 1 test: invalid env exits 1 before connecting and logs names, not values.
- `compose-policy.test.ts`, 3 tests:
  - Compose and the tests use the same pinned image
  - the port is published on loopback only
  - the named volume uses the PostgreSQL 18 path

**Integration tests** (Testcontainers, same image and init script as Compose):
- `app-role.test.ts`, 8 tests. The database is named `Pheme-IT` and the password is
  `it's a "quoted"; \secret $HOME`, to exercise the init script's SQL quoting.
  - `pheme_app` logs in and passes the `SELECT 1` check
  - it has no elevated role attributes
  - while connected (`current_user = pheme_app`), each of these fails with SQLSTATE 42501: CREATE
    TABLE in `public`, CREATE SCHEMA, CREATE TEMP TABLE, CREATE ROLE, CREATE DATABASE
  - another login role cannot connect, because CONNECT was revoked from PUBLIC
- `connect-timeout.test.ts`, 1 test: a TCP server that accepts connections but never answers makes
  the pool give up after the configured 300 ms timeout.
- `dev-process.test.ts`, 3 tests:
  - `dev` logs `db ok` with the target but not the password, and writes nothing to stdout
  - a wrong password exits 1 with `err.code` 28P01 and no password in the output
  - **skipped on Windows:** SIGINT gives exit 0. Node on Windows cannot deliver SIGINT to a child
    process; it terminates it instead. This test runs in Linux CI.

**Redaction mutation check.** I temporarily replaced `scrub(line)` with `line` in
`server/src/logging/logger.ts`. 3 of the 6 logger tests then failed: the message/stack/cause,
`AggregateError` and URL-password tests. After `git checkout` restored the file, all 6 passed. The
field-path redaction tests still passed during the mutation, because pino's `redact` covers them
independently.

## Compose and `dev` acceptance

Run by `C:\dev\.tools\phase0-acceptance.ps1` (kept outside the repository) at 2026-10-05T22:49:49Z.
Ctrl+C was a real `CTRL_C_EVENT`, the event Windows sends when a user presses Ctrl+C. It was sent
with `GenerateConsoleCtrlEvent` to a process started in its own console.

**Compose service:**

| Check | Result |
|---|---|
| `docker compose up --detach --wait` | exit 0; `pheme-postgres-1` is `healthy` |
| Published port | `127.0.0.1:5432->5432/tcp`; the only host listener on 5432 is `127.0.0.1:5432` |
| Mounts | volume `pheme_pgdata` at `/var/lib/postgresql` (read-write); bind `docker/postgres/init` at `/docker-entrypoint-initdb.d` (`rw=false`) |
| `SHOW data_directory` | `/var/lib/postgresql/18/docker` |
| `SELECT version()` | `PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on x86_64-pc-linux-gnu …` |
| `pheme_app` attributes | not superuser; cannot create databases or roles; no replication; no RLS bypass; connection limit 20 |
| Database ACL | `{pheme_admin=CTc/pheme_admin,pheme_app=c/pheme_admin}`: PUBLIC has no CONNECT or TEMP |
| `has_schema_privilege('pheme_app', 'public', 'CREATE')` | `false` |

When the volume was first created, earlier in the session, the container log showed the entrypoint
running `/docker-entrypoint-initdb.d/10-create-app-role.sh`. Its syntax was also checked with
`bash -n` inside the same image, because no Git Bash is installed locally.

**`dev` runs** (the log messages are the `msg` fields, in order):

| Scenario | Exit | Log messages |
|---|---|---|
| `node --env-file-if-exists=../.env --import tsx src/main.ts` in `server/`, Ctrl+C after `db ok` | **0** | dev starting, db ok, shutdown requested, shutdown complete |
| `npm run dev` from the root, Ctrl+C after `db ok` | 1 (npm's code) | dev starting, db ok, shutdown requested, shutdown complete |
| `docker compose restart postgres` while `dev` runs, then Ctrl+C | **0** | dev starting, db ok, idle database client error (`57P01`), shutdown requested, shutdown complete. The process stayed alive through the restart. |
| Database stopped (`docker compose stop postgres`) before start | 1 | dev starting, db check failed (`ECONNREFUSED`); 358 ms in total, including Node and tsx startup |
| No `.env`; `DATABASE_URL` malformed and containing a marker secret, `DB_POOL_MAX=0`, `LOG_LEVEL=loud` | 1 | `Invalid environment for "dev": LOG_LEVEL is invalid (…); DATABASE_URL is invalid (Invalid URL); DB_POOL_MAX is invalid (Too small: expected number to be >=1)`. Neither the marker nor `loud` appears in the output. |
| No `.env` and no `DATABASE_URL` | 1 | `Invalid environment for "dev": DATABASE_URL is missing` |
| `docker compose down`, then `up --detach --wait`, then `dev` with Ctrl+C | **0** | The volume remained, the entrypoint logged `Skipping initialization`, `pheme_app` still existed, and `dev` logged in with the existing password. |

In every run, stdout contained no JSON log lines; npm printed only its script banner there.
Afterwards I searched all 14 captured log files for the three secret values in `.env`
(`POSTGRES_PASSWORD`, `PHEME_APP_DB_PASSWORD` and `DATABASE_URL`): 0 matches.

**Why `npm run dev` exits 1 on Windows.** The server's own exit code is 0, as the direct `node`
run shows, and both runs log the same complete shutdown. npm's
`@npmcli/run-script/lib/signal-manager.js` forwards the signal with `proc.kill(signal)` to the
`cmd.exe` it started. On Windows that terminates the shell, so npm reports a failure. The README
documents the direct command for anyone who needs the server's exit code.

## CI design (results reported in the PR)

- `push` runs (every branch) test the pushed commit, which is the PR head SHA used for the local
  evidence above.
- `pull_request` runs test GitHub's temporary merge commit of that head into `main`, which is a
  different SHA.
- Each job's summary records the event and the tested SHA. For pull requests it also records the
  PR head and base SHAs, and whether the merge result has the same file tree as the head.
- Jobs:
  - `checks`: `npm ci`, lint, typecheck, unit tests
  - `integration`: `npm ci`, integration tests (including the Linux SIGINT test), then a Compose
    smoke test using `.env.example`, removing its throwaway volume afterwards

## Skipped, blocked or not verified

- **Skipped on Windows:** the automated SIGINT test, for the reason given above. A real Ctrl+C was
  verified manually instead.
- **Not verified:** the GPG signature of Node's `SHASUMS256.txt`, because GPG is not installed.
  Only the SHA-256 checksum was compared.
- **Not exercised:** the README's `\password pheme_app` procedure, which needs an interactive
  terminal.
- **Pending at the time of writing:** the CI runs for the pushed head SHA and the PR merge SHA.
- **Not covered:** macOS or Linux desktop development (only CI runs on Linux), performance
  measurement, and any security assessment beyond the tests listed here.
