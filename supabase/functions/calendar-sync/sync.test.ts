import { assertEquals } from 'jsr:@std/assert@1';
import { CalendarGoneError, eventIdForTask, GoogleApiError, InvalidGrantError } from '../_shared/google.ts';
import type { EventTask } from '../_shared/google.ts';
import type { TaskEventRow } from '../_shared/tasks.ts';
import { handleTaskChange, isAuthorizedWebhook, shouldSync, StoredCredentials, SyncDeps, TaskRecord, WebhookPayload } from './sync.ts';

const TASK_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const NOW = new Date('2026-11-23T12:00:00Z');

const record: TaskRecord = {
  id: TASK_ID, user_id: 'u1', due_date: '2026-11-25', task_type: 'harvest', completed_at: null,
  google_calendar_event_id: null,
};
const row = (overrides: Partial<TaskEventRow> = {}): TaskEventRow => ({
  ...record, planting: { cell_row: 0, cell_col: 1, bed: { name: 'Herbs' }, plant: { name: 'Tomato' } }, ...overrides,
});
const connected: StoredCredentials = {
  refresh_token: 'r-1', access_token: 'cached', expires_at: '2026-11-23T12:30:00Z', calendar_id: 'cal-1',
  disconnected_reason: null,
};

const insert = (r = record): WebhookPayload => ({ type: 'INSERT', table: 'tasks', record: r, old_record: null });
const update = (old: TaskRecord, r: TaskRecord): WebhookPayload => ({ type: 'UPDATE', table: 'tasks', record: r, old_record: old });
const remove = (old: TaskRecord): WebhookPayload => ({ type: 'DELETE', table: 'tasks', record: null, old_record: old });

/** In-memory fakes recording what handleTaskChange does. */
function fakes(opts: {
  credentials?: StoredCredentials | null;
  task?: TaskEventRow | null;
  upsert?: (accessToken: string, task: EventTask) => Promise<string>;
  refresh?: () => Promise<{ access_token: string; expires_at: string }>;
} = {}) {
  const log = {
    refreshed: 0,
    savedTokens: [] as unknown[],
    revoked: [] as unknown[],
    gone: [] as unknown[],
    upserts: [] as { token: string; calendarId: string; task: EventTask }[],
    deletes: [] as { token: string; calendarId: string; eventId: string }[],
    eventIds: [] as [string, string][],
  };
  const deps: SyncDeps = {
    loadCredentials: () => Promise.resolve(opts.credentials === undefined ? connected : opts.credentials),
    saveAccessToken: (userId, refreshToken, token) => { log.savedTokens.push([userId, refreshToken, token]); return Promise.resolve(); },
    markRevoked: (userId, refreshToken) => { log.revoked.push([userId, refreshToken]); return Promise.resolve(); },
    markCalendarDeleted: (userId, calendarId) => { log.gone.push([userId, calendarId]); return Promise.resolve(); },
    loadTask: () => Promise.resolve(opts.task === undefined ? row() : opts.task),
    setEventId: (taskId, eventId) => { log.eventIds.push([taskId, eventId]); return Promise.resolve(); },
    refreshAccessToken: () => {
      log.refreshed++;
      return opts.refresh?.() ?? Promise.resolve({ access_token: 'fresh', expires_at: '2026-11-23T13:00:00Z' });
    },
    upsertEvent: (token, calendarId, task) => {
      log.upserts.push({ token, calendarId, task });
      return opts.upsert?.(token, task) ?? Promise.resolve(eventIdForTask(TASK_ID));
    },
    deleteEvent: (token, calendarId, eventId) => { log.deletes.push({ token, calendarId, eventId }); return Promise.resolve(); },
    now: () => NOW,
  };
  return { deps, log };
}

Deno.test('isAuthorizedWebhook requires a configured secret and an exact header match', () => {
  assertEquals(isAuthorizedWebhook('s3cret', 's3cret'), true);
  assertEquals(isAuthorizedWebhook('wrong!', 's3cret'), false);
  assertEquals(isAuthorizedWebhook('s3cre', 's3cret'), false);
  assertEquals(isAuthorizedWebhook(null, 's3cret'), false);
  assertEquals(isAuthorizedWebhook('', ''), false);
  assertEquals(isAuthorizedWebhook('x', undefined), false);
});

Deno.test('shouldSync ignores an id-only change but not date, type or completion changes', () => {
  assertEquals(shouldSync(null, record), true);
  assertEquals(shouldSync(record, { ...record, google_calendar_event_id: 'evt-1' }), false);
  assertEquals(shouldSync(record, { ...record, due_date: '2026-11-26' }), true);
  assertEquals(shouldSync(record, { ...record, task_type: 'prune' }), true);
  assertEquals(shouldSync(record, { ...record, completed_at: '2026-11-23T10:00:00Z' }), true);
});

Deno.test('a new task becomes an event with its plant and place, and the event id is stored', async () => {
  const { deps, log } = fakes();

  assertEquals(await handleTaskChange(deps, insert()), 'synced');

  assertEquals(log.upserts.length, 1);
  assertEquals(log.upserts[0].token, 'cached');
  assertEquals(log.upserts[0].calendarId, 'cal-1');
  assertEquals(log.upserts[0].task.plant_name, 'Tomato');
  assertEquals(log.upserts[0].task.location, 'Herbs, row 1 col 2');
  assertEquals(log.upserts[0].task.task_id, TASK_ID);
  assertEquals(log.eventIds, [[TASK_ID, eventIdForTask(TASK_ID)]]);
  assertEquals(log.refreshed, 0);
});

Deno.test('the task is synced as it is now, not as the payload saw it', async () => {
  const done = row({ completed_at: '2026-11-23T11:00:00Z', google_calendar_event_id: 'evt-1' });
  const { deps, log } = fakes({ task: done, upsert: () => Promise.resolve('evt-1') });

  assertEquals(await handleTaskChange(deps, insert()), 'synced');

  assertEquals(log.upserts[0].task.completed_at, '2026-11-23T11:00:00Z');
  assertEquals(log.upserts[0].task.google_calendar_event_id, 'evt-1');
  assertEquals(log.eventIds, []); // unchanged, so not written back
});

Deno.test('an id-only update does nothing', async () => {
  const { deps, log } = fakes();
  const withId = { ...record, google_calendar_event_id: 'evt-1' };

  assertEquals(await handleTaskChange(deps, update(record, withId)), 'no_op');
  assertEquals(log.upserts.length, 0);
});

Deno.test('completing a task updates its event', async () => {
  const { deps, log } = fakes();
  const done = { ...record, completed_at: '2026-11-23T11:00:00Z' };

  assertEquals(await handleTaskChange(deps, update(record, done)), 'synced');
  assertEquals(log.upserts.length, 1);
});

Deno.test('nothing happens for users without a working connection', async () => {
  const broken: StoredCredentials[] = [
    { ...connected, refresh_token: null, disconnected_reason: 'revoked' },
    { ...connected, disconnected_reason: 'calendar_deleted' },
  ];
  for (const credentials of [null, ...broken]) {
    const { deps, log } = fakes({ credentials });
    assertEquals(await handleTaskChange(deps, insert()), 'not_connected');
    assertEquals(log.upserts.length + log.deletes.length + log.refreshed, 0);
  }
});

Deno.test('other tables and a task deleted before syncing are skipped', async () => {
  const { deps, log } = fakes({ task: null });
  assertEquals(await handleTaskChange(deps, { ...insert(), table: 'beds' }), 'ignored');
  assertEquals(await handleTaskChange(deps, insert()), 'task_gone');
  assertEquals(log.upserts.length, 0);
});

Deno.test('a deleted task deletes its event, even one whose id was never stored', async () => {
  const { deps, log } = fakes();

  assertEquals(await handleTaskChange(deps, remove({ ...record, google_calendar_event_id: 'evt-1' })), 'deleted');
  assertEquals(await handleTaskChange(deps, remove(record)), 'deleted');

  assertEquals(log.deletes.map((d) => [d.calendarId, d.eventId]), [['cal-1', 'evt-1'], ['cal-1', eventIdForTask(TASK_ID)]]);
});

Deno.test('an expiring access token is refreshed first and cached', async () => {
  const { deps, log } = fakes({ credentials: { ...connected, expires_at: '2026-11-23T12:00:30Z' } });

  assertEquals(await handleTaskChange(deps, insert()), 'synced');

  assertEquals(log.upserts[0].token, 'fresh');
  assertEquals(log.savedTokens, [['u1', 'r-1', { access_token: 'fresh', expires_at: '2026-11-23T13:00:00Z' }]]);
});

Deno.test('a cached token Google rejects is refreshed and the call retried once', async () => {
  const { deps, log } = fakes({
    upsert: (token) =>
      token === 'cached' ? Promise.reject(new GoogleApiError('event create failed: 401', 401)) : Promise.resolve('evt-1'),
  });

  assertEquals(await handleTaskChange(deps, insert()), 'synced');
  assertEquals(log.upserts.map((u) => u.token), ['cached', 'fresh']);
  assertEquals(log.refreshed, 1);
});

Deno.test('a revoked refresh token marks the connection revoked', async () => {
  const { deps, log } = fakes({
    credentials: { ...connected, access_token: null, expires_at: null },
    refresh: () => Promise.reject(new InvalidGrantError('invalid_grant')),
  });

  assertEquals(await handleTaskChange(deps, insert()), 'disconnected');
  assertEquals(log.revoked, [['u1', 'r-1']]);
  assertEquals(log.gone, []);
});

Deno.test('a deleted Samwise calendar marks the connection broken', async () => {
  const { deps, log } = fakes({ upsert: () => Promise.reject(new CalendarGoneError('cal-1')) });

  assertEquals(await handleTaskChange(deps, insert()), 'disconnected');
  assertEquals(log.gone, [['u1', 'cal-1']]);
  assertEquals(log.revoked, []);
});

Deno.test('other errors fail this sync without touching the connection', async () => {
  const { deps, log } = fakes({ upsert: () => Promise.reject(new GoogleApiError('event create failed: 500', 500)) });

  assertEquals(await handleTaskChange(deps, insert()), 'failed');
  assertEquals(log.revoked.length + log.gone.length + log.eventIds.length, 0);
});
