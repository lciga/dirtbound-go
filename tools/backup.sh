#!/bin/sh
# Uses the selected Compose project. Password stays inside PostgreSQL's environment.
set -eu
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
target="backups/dirtbound-$(date -u +%Y%m%dT%H%M%SZ).dump"
# Custom pg_dump format includes compression and can be checked with pg_restore -l.
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$target.tmp"
mv "$target.tmp" "$target"
printf 'Backup saved: %s\n' "$target"
