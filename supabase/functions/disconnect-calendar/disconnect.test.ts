import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { GoogleApiError, InvalidGrantError } from '../_shared/google.ts';
import { disconnectCalendar, DisconnectDeps } from './disconnect.ts';

/** In-memory fakes recording, in order, what disconnectCalendar does. */
function fakes(opts: {
  credentials?: { refresh_token: string | null; calendar_id: string } | null;
  refresh?: () => Promise<{ access_token: string }>;
  deleteCalendar?: () => Promise<void>;
  revoke?: () => Promise<void>;
} = {}) {
  const log: string[] = [];
  const deps: DisconnectDeps = {
    loadCredentials: () =>
      Promise.resolve(opts.credentials === undefined ? { refresh_token: 'r-1', calendar_id: 'cal-1' } : opts.credentials),
    refreshAccessToken: (token) => { log.push(`refresh ${token}`); return opts.refresh?.() ?? Promise.resolve({ access_token: 'a-1' }); },
    deleteCalendar: (token, calendarId) => { log.push(`delete calendar ${calendarId} with ${token}`); return opts.deleteCalendar?.() ?? Promise.resolve(); },
    revokeToken: (token) => { log.push(`revoke ${token}`); return opts.revoke?.() ?? Promise.resolve(); },
    deleteCredentials: (userId) => { log.push(`forget ${userId}`); return Promise.resolve(); },
    clearEventIds: (userId) => { log.push(`clear event ids ${userId}`); return Promise.resolve(); },
  };
  return { deps, log };
}

Deno.test('disconnecting deletes the calendar, revokes access, then forgets the connection', async () => {
  const { deps, log } = fakes();

  assertEquals(await disconnectCalendar(deps, 'u1'), { calendarDeleted: true });
  assertEquals(log, ['refresh r-1', 'delete calendar cal-1 with a-1', 'revoke r-1', 'forget u1', 'clear event ids u1']);
});

Deno.test('a revoked connection is forgotten; its calendar stays for the user to delete', async () => {
  const { deps, log } = fakes({ credentials: { refresh_token: null, calendar_id: 'cal-1' } });

  assertEquals(await disconnectCalendar(deps, 'u1'), { calendarDeleted: false });
  assertEquals(log, ['forget u1', 'clear event ids u1']);
});

Deno.test('access removed in Google meanwhile still disconnects', async () => {
  const { deps, log } = fakes({ refresh: () => Promise.reject(new InvalidGrantError('invalid_grant')) });

  assertEquals(await disconnectCalendar(deps, 'u1'), { calendarDeleted: false });
  assertEquals(log, ['refresh r-1', 'forget u1', 'clear event ids u1']);
});

Deno.test('a failed calendar delete keeps the connection so the user can retry', async () => {
  const { deps, log } = fakes({ deleteCalendar: () => Promise.reject(new GoogleApiError('calendar delete failed: 500', 500)) });

  await assertRejects(() => disconnectCalendar(deps, 'u1'), GoogleApiError);
  assertEquals(log, ['refresh r-1', 'delete calendar cal-1 with a-1']);
});

Deno.test('other token errors keep the connection too', async () => {
  const { deps, log } = fakes({ refresh: () => Promise.reject(new Error('token refresh failed: 503')) });

  await assertRejects(() => disconnectCalendar(deps, 'u1'), Error, '503');
  assertEquals(log, ['refresh r-1']);
});

Deno.test('a failed revoke after deleting the calendar still disconnects', async () => {
  const { deps, log } = fakes({ revoke: () => Promise.reject(new Error('token revoke failed: 503')) });

  assertEquals(await disconnectCalendar(deps, 'u1'), { calendarDeleted: true });
  assertEquals(log.slice(-2), ['forget u1', 'clear event ids u1']);
});

Deno.test('disconnecting without a connection does nothing', async () => {
  const { deps, log } = fakes({ credentials: null });

  assertEquals(await disconnectCalendar(deps, 'u1'), { calendarDeleted: false });
  assertEquals(log, []);
});
