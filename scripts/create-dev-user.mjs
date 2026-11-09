#!/usr/bin/env node
// Creates (or resets the password of) a local email/password user for development,
// so you can sign in without Google. Local Supabase only — refuses any other host.
//
// Usage: npm run dev:user                      -> dev@samwise.local / samwise-dev
//        npm run dev:user -- me@example.com s3cret
import { spawnSync } from 'node:child_process';

const email = process.argv[2] ?? 'dev@samwise.local';
const password = process.argv[3] ?? 'samwise-dev';

const status = spawnSync('npx --no-install supabase status -o env', {
  encoding: 'utf8',
  shell: true, // npx is npx.cmd on Windows
});
const env = Object.fromEntries(
  (status.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const apiUrl = env.API_URL;
const serviceKey = env.SERVICE_ROLE_KEY;
if (!apiUrl || !serviceKey) {
  console.error('Could not read the local Supabase status. Is it running? Try: npx supabase start');
  process.exit(1);
}
const host = new URL(apiUrl).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.error(`Refusing to create a dev user on ${apiUrl}: local Supabase only.`);
  process.exit(1);
}

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

const created = await fetch(`${apiUrl}/auth/v1/admin/users`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ email, password, email_confirm: true }),
});

if (created.ok) {
  console.log(`Created local user ${email} (password: ${password}).`);
  process.exit(0);
}

// Already exists: reset its password so the documented credentials always work.
const list = await fetch(`${apiUrl}/auth/v1/admin/users?per_page=1000`, { headers });
const existing = list.ok ? (await list.json()).users?.find((u) => u.email === email) : undefined;
if (!existing) {
  console.error(`Failed to create ${email}: ${created.status} ${await created.text()}`);
  process.exit(1);
}
const updated = await fetch(`${apiUrl}/auth/v1/admin/users/${existing.id}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ password, email_confirm: true }),
});
if (!updated.ok) {
  console.error(`User ${email} exists but resetting its password failed: ${updated.status} ${await updated.text()}`);
  process.exit(1);
}
console.log(`Local user ${email} already existed; password reset to: ${password}`);
