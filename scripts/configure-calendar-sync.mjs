#!/usr/bin/env node
// Points the local database's tasks trigger (migration 0007) at the locally served
// calendar-sync function: stores its URL and the webhook secret in Vault.
// Run once after `npx supabase start` and again after every `npx supabase db reset`.
//
// The secret is read from supabase/functions/.env (CALENDAR_SYNC_WEBHOOK_SECRET), the
// same file the function reads it from, and passed to psql over stdin, never printed.
import { readFileSync } from 'node:fs';
import { runPsql } from './psql.mjs';

const envFile = 'supabase/functions/.env';
let secret;
try {
  secret = readFileSync(envFile, 'utf8').match(/^CALENDAR_SYNC_WEBHOOK_SECRET=(.+)$/m)?.[1].trim();
} catch {
  // reported below
}
if (!secret) {
  console.error(`CALENDAR_SYNC_WEBHOOK_SECRET is missing from ${envFile} (see the README's Setup section).`);
  process.exit(1);
}

// The request is sent from inside the database container, which reaches the API
// gateway by its container name on the Supabase Docker network.
const projectId = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
const url = `http://supabase_kong_${projectId}:8000/functions/v1/calendar-sync`;

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
// DO blocks print nothing (create_secret would print the new secret's id).
const upsert = (name, value) => `
do $vault$
declare
  existing uuid := (select id from vault.secrets where name = ${literal(name)});
begin
  if existing is null then
    perform vault.create_secret(${literal(value)}, ${literal(name)});
  else
    perform vault.update_secret(existing, ${literal(value)});
  end if;
end $vault$;`;

const status = runPsql(['-q'], {
  input: `begin;${upsert('calendar_sync_url', url)}${upsert('calendar_sync_webhook_secret', secret)}\ncommit;\n`,
});
if (status !== 0) process.exit(status);
console.log(`Calendar sync configured: the tasks trigger now calls ${url}`);
