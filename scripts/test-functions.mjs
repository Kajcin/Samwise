#!/usr/bin/env node
// Runs Deno unit tests and type-checks every Edge Function entry point.
// A no-op until Stage 5 adds supabase/functions.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = 'supabase/functions';
if (!existsSync(root)) {
  console.log('No Edge Functions yet.');
  process.exit(0);
}

const files = readdirSync(root, { recursive: true }).map((p) => join(root, String(p)).replaceAll('\\', '/'));

function deno(args) {
  const result = spawnSync('deno', args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`Failed to start deno (is it installed?): ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (files.some((f) => f.endsWith('.test.ts'))) deno(['test', root]);

// index.ts files aren't unit-tested (they only wire requests to tested modules),
// so at least make sure they type-check.
const entryPoints = files.filter((f) => f.endsWith('/index.ts'));
if (entryPoints.length) deno(['check', ...entryPoints]);
