#!/bin/sh
# Emergency only: removes every stored login and token, so everyone must sign in and reconnect their schools.
# See breach-runbook.md. Without --confirm it only shows what would be removed. It prints counts, never values.
set -eu

PHRASE="revoke-all-stored-tokens"
COMPOSE="docker compose -f compose.staging.yml"

psql_run() { $COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d schuly -v ON_ERROR_STOP=1 -q'; }

COUNTS='SELECT '"'"'stored logins'"'"' AS item, count(*) FROM "VaultEntries"
UNION ALL SELECT '"'"'refresh tokens'"'"', count(*) FROM "ToamaisutaaRefreshTokens"
UNION ALL SELECT '"'"'MCP tokens'"'"', count(*) FROM "McpTokens"
UNION ALL SELECT '"'"'MCP API keys'"'"', count(*) FROM "McpApiKeys";'

if [ "$#" -eq 0 ]; then
	echo "Dry run. This would remove:"
	echo "$COUNTS" | psql_run
	echo "To remove them, run: sh revoke-stored-tokens.sh --confirm $PHRASE"
	exit 0
fi

if [ "$#" -ne 2 ] || [ "$1" != "--confirm" ] || [ "$2" != "$PHRASE" ]; then
	echo "Usage: sh revoke-stored-tokens.sh [--confirm $PHRASE]" >&2
	exit 2
fi

# The backend caches vault entries in memory, so it must not be running during the delete.
$COMPOSE stop backend

psql_run <<'SQL'
BEGIN;
DELETE FROM "VaultEntries";
DELETE FROM "ToamaisutaaRefreshTokens";
DELETE FROM "McpTokens";
DELETE FROM "McpApiKeys";
COMMIT;
SQL

echo "Removed. What is left:"
echo "$COUNTS" | psql_run

$COMPOSE start backend
echo "Backend restarted. School accounts show as needing a reconnect after their next sync."
echo "Tokens already copied stay valid at the school or Microsoft until they expire. See breach-runbook.md."
