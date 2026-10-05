#!/usr/bin/env bash
# Creates the least-privilege role used by the server. The official image runs files in
# /docker-entrypoint-initdb.d only when the data directory is empty, so a later change to
# PHEME_APP_DB_PASSWORD needs ALTER ROLE (or a destructive reset of the volume).
#
# The entrypoint executes this file if it is executable and sources it otherwise (file modes
# differ between Windows bind mounts, Linux checkouts and Testcontainers copies), so the script
# uses the same shell options as the entrypoint and avoids `set -u`.
set -Eeo pipefail

for required in POSTGRES_USER POSTGRES_DB PHEME_APP_DB_PASSWORD; do
  if [ -z "${!required:-}" ]; then
    echo "10-create-app-role.sh: $required must be set" >&2
    exit 1
  fi
done

# The quoted heredoc ('SQL') stops the shell from expanding anything in the SQL. psql reads the
# values from the environment with \getenv (no password in the process arguments) and quotes
# them itself: :"name" as an identifier, :'name' as a string literal.
psql --no-psqlrc --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" <<'SQL'
\getenv db_name POSTGRES_DB
\getenv app_password PHEME_APP_DB_PASSWORD
\set app_role pheme_app

CREATE ROLE :"app_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 20 PASSWORD :'app_password';

-- By default every role (PUBLIC) may connect to a database and create temporary tables in it.
-- Revoking that means only roles granted CONNECT explicitly can log in to this database.
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO :"app_role";

-- PostgreSQL 15+ already withholds CREATE on schema public from PUBLIC; stated explicitly.
-- Table privileges are granted by later migrations, once tables exist.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
