#!/usr/bin/env node
// Resets the local Supabase DB (migrations + seed) and runs every SQL test file.
// Requires a running local stack (`npx supabase start`). Stops on the first failure.
//
// The reset deletes everything in the database, so it refuses to run while the
// database has user accounts (your dev account, its beds, plants, tasks and calendar
// connection). To test without losing data, run single files instead; each one rolls
// itself back:
//   npm run db:psql -- -f supabase/tests/sql/0010_plant_editing.test.sql
// To reset anyway:
//   npm run test:sql -- --reset
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { queryPsql, runPsql } from './psql.mjs';

const dir = 'supabase/tests/sql';

if (!process.argv.includes('--reset')) {
  const accounts = queryPsql('select count(*) from auth.users');
  if (accounts === null) {
    console.error('Could not check the database for accounts, so it was not reset. Is the local stack running?');
    process.exit(1);
  }
  if (Number(accounts) > 0) {
    console.error(
      [
        `The local database has ${accounts} account(s). test:sql resets the database, which would delete`,
        'them and all their data (beds, plants, tasks, photos, the calendar connection). Nothing was changed.',
        '',
        'Run single test files instead; each one rolls itself back:',
        '  npm run db:psql -- -f supabase/tests/sql/<file>',
        'Or, to delete everything and run them all:',
        '  npm run test:sql -- --reset',
      ].join('\n'),
    );
    process.exit(1);
  }
}

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
