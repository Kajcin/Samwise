#!/usr/bin/env node
// Resets the local Supabase DB (migrations + seed) and runs every SQL test file.
// Requires a running local stack (`npx supabase start`). Stops on the first failure.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { runPsql } from './psql.mjs';

const dir = 'supabase/tests/sql';

const reset = spawnSync('npx --no-install supabase db reset', { stdio: 'inherit', shell: true });
if (reset.status !== 0) process.exit(reset.status ?? 1);

let files = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.test.sql')).sort();
} catch {
  // no tests directory yet
}
if (files.length === 0) {
  console.log('No SQL tests found.');
  process.exit(0);
}

for (const file of files) {
  console.log(`== ${dir}/${file}`);
  const status = runPsql(['-q', '-f', `${dir}/${file}`]);
  if (status !== 0) process.exit(status);
}
console.log(`All ${files.length} SQL test files passed.`);
