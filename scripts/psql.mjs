#!/usr/bin/env node
// Runs psql against the local Supabase database, always with ON_ERROR_STOP=1
// so a failing statement makes the command exit non-zero.
//
// Uses a locally installed psql if there is one; otherwise falls back to the
// psql inside the Supabase Postgres container, so no local install is needed.
//
// Usage:
//   npm run db:psql -- -f supabase/tests/sql/0001_rls.test.sql
//   npm run db:psql -- -c "select count(*) from beds"
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function hasLocalPsql() {
  const probe = spawnSync('psql', ['--version'], { stdio: 'ignore' });
  return probe.status === 0;
}

function localDbUrl() {
  if (process.env.DB_URL) return process.env.DB_URL;
  const status = spawnSync('npx --no-install supabase status -o env', {
    encoding: 'utf8',
    shell: true, // npx is npx.cmd on Windows
  });
  // Prints DB_URL="postgresql://..." — strip the quotes.
  const line = (status.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('DB_URL='));
  if (!line) {
    console.error('Could not read DB_URL. Is the local stack running? Try: npx supabase start');
    process.exit(1);
  }
  return line.slice('DB_URL='.length).replace(/^"|"$/g, '');
}

function dbContainerName() {
  const config = readFileSync('supabase/config.toml', 'utf8');
  const match = config.match(/^project_id\s*=\s*"([^"]+)"/m);
  if (!match) {
    console.error('Could not find project_id in supabase/config.toml');
    process.exit(1);
  }
  return `supabase_db_${match[1]}`;
}

/** Runs psql with the given args; returns its exit code. `-f <file>` is supported in both modes. */
export function runPsql(args) {
  const rest = [];
  let input;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-f') {
      input = readFileSync(args[++i]);
    } else {
      rest.push(args[i]);
    }
  }
  // The file is streamed over stdin, because the container can't see host paths.
  const fileArgs = input ? ['-f', '-'] : [];
  const stdio = [input ? 'pipe' : 'inherit', 'inherit', 'inherit'];

  const result = hasLocalPsql()
    ? spawnSync('psql', [localDbUrl(), '-v', 'ON_ERROR_STOP=1', ...rest, ...fileArgs], { input, stdio })
    : spawnSync(
        'docker',
        ['exec', '-i', dbContainerName(), 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...rest, ...fileArgs],
        { input, stdio },
      );

  if (result.error) {
    console.error(`Failed to start psql: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runPsql(process.argv.slice(2)));
}
