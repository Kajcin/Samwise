import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { connectCalendar, ConnectDeps } from './connect.ts';
import type { EventTask } from '../_shared/google.ts';
import type { TaskEventRow } from '../_shared/tasks.ts';

const herbs = [{ planting: { cell_row: 0, cell_col: 0, bed: { name: 'Herbs' } } }];
const row = (id: string, overrides: Partial<TaskEventRow> = {}): TaskEventRow => ({
  id, user_id: 'u1', due_date: '2026-11-20', task_type: 'harvest', completed_at: null,
  google_calendar_event_id: null, plant: { name: 'Tomato' }, plantings: herbs, ...overrides,
});

/** In-memory fakes recording what connectCalendar does. */
function fakes(
  opts: {
    storedCalendarId?: string | null;
    calendarId?: string;
    tasks?: TaskEventRow[];
    failUpsertFor?: string;
    language?: 'en' | 'cs';
  } = {},
) {
  const log = {
    saved: [] as unknown[],
    cleared: [] as string[],
    upserted: [] as EventTask[],
    eventIds: new Map<string, string>(),
    listedFrom: [] as string[],
  };
  const deps: ConnectDeps = {
    exchangeCode: (code) =>
      code === 'bad'
        ? Promise.reject(new Error('code exchange failed: 400 invalid_grant'))
        : Promise.resolve({ refresh_token: 'r-1', access_token: 'a-1', expires_at: '2026-11-19T13:00:00.000Z' }),
    getStoredCalendarId: () => Promise.resolve(opts.storedCalendarId ?? null),
    ensureCalendar: (_token, existing) => Promise.resolve(opts.calendarId ?? existing ?? 'cal-new'),
    saveCredentials: (credentials) => { log.saved.push(credentials); return Promise.resolve(); },
    clearEventIds: (userId) => { log.cleared.push(userId); return Promise.resolve(); },
    listTasksToSync: (_userId, fromDate) => { log.listedFrom.push(fromDate); return Promise.resolve(opts.tasks ?? []); },
    loadLanguage: () => Promise.resolve(opts.language ?? 'en'),
    upsertEvent: (_token, _calendarId, task) => {
      log.upserted.push(task);
      if (task.due_date === opts.failUpsertFor) return Promise.reject(new Error('event upsert failed: 403'));
      return Promise.resolve(`evt-${log.upserted.length}`);
    },
    setEventId: (taskId, eventId) => { log.eventIds.set(taskId, eventId); return Promise.resolve(); },
    today: () => '2026-11-19',
  };
  return { deps, log };
}

Deno.test('first connect creates the calendar, stores credentials and backfills upcoming tasks', async () => {
  const { deps, log } = fakes({ tasks: [row('t1'), row('t2', { task_type: 'prune', plant: null, plantings: [] })] });

  const result = await connectCalendar(deps, 'u1', 'code-1');

  assertEquals(result, { calendarId: 'cal-new', backfilled: 2, failed: 0 });
  assertEquals(log.saved, [{
    user_id: 'u1', refresh_token: 'r-1', access_token: 'a-1', expires_at: '2026-11-19T13:00:00.000Z', calendar_id: 'cal-new',
    disconnected_reason: null,
  }]);
  assertEquals(log.listedFrom, ['2026-11-19']);
  assertEquals(log.upserted[0].plant_name, 'Tomato');
  assertEquals(log.upserted[0].location, 'Herbs, row 1 col 1');
  assertEquals(log.upserted[1].plant_name, null);
  assertEquals([...log.eventIds], [['t1', 'evt-1'], ['t2', 'evt-2']]);
});

Deno.test('a new calendar clears old event ids first, so every task is synced into it', async () => {
  const { deps, log } = fakes({ storedCalendarId: null });

  await connectCalendar(deps, 'u1', 'code-1');

  assertEquals(log.cleared, ['u1']);
});

Deno.test('reconnecting to the same calendar keeps existing event ids', async () => {
  const { deps, log } = fakes({ storedCalendarId: 'cal-1' });

  const result = await connectCalendar(deps, 'u1', 'code-1');

  assertEquals(result.calendarId, 'cal-1');
  assertEquals(log.cleared, []);
});

Deno.test('reconnecting updates events that already exist, without rewriting their ids', async () => {
  const done = row('t2', { completed_at: '2026-11-20T08:00:00Z', google_calendar_event_id: 'evt-t2' });
  const { deps, log } = fakes({ storedCalendarId: 'cal-1', tasks: [row('t1'), done] });
  deps.upsertEvent = (_token, _calendarId, task) => {
    log.upserted.push(task);
    return Promise.resolve(task.google_calendar_event_id ?? 'evt-t1');
  };

  const result = await connectCalendar(deps, 'u1', 'code-1');

  assertEquals(result.backfilled, 2);
  assertEquals(log.upserted[1].completed_at, '2026-11-20T08:00:00Z');
  assertEquals([...log.eventIds], [['t1', 'evt-t1']]);
});

Deno.test('finished upcoming tasks are synced too, also into a new calendar', async () => {
  // After a disconnect their event ids are cleared; they still belong on the calendar, with a ✓.
  const done = row('t1', { completed_at: '2026-11-19T08:00:00Z' });
  const { deps, log } = fakes({ tasks: [done] });

  await connectCalendar(deps, 'u1', 'code-1');

  assertEquals(log.upserted.map((t) => t.completed_at), ['2026-11-19T08:00:00Z']);
  assertEquals([...log.eventIds], [['t1', 'evt-1']]);
});

Deno.test('a recreated calendar (the old one was deleted) clears old event ids', async () => {
  const { deps, log } = fakes({ storedCalendarId: 'cal-deleted', calendarId: 'cal-2' });

  await connectCalendar(deps, 'u1', 'code-1');

  assertEquals(log.cleared, ['u1']);
});

Deno.test('connecting writes the events in the user’s language', async () => {
  const { deps, log } = fakes({ language: 'cs', tasks: [row('t1', { plant: { name: 'Tomato', name_cs: 'Rajče' } })] });

  await connectCalendar(deps, 'u1', 'code-1');

  assertEquals([log.upserted[0].plant_name, log.upserted[0].language], ['Rajče', 'cs']);
});

Deno.test('a failed event is counted and the backfill carries on', async () => {
  const { deps, log } = fakes({ tasks: [row('t1'), row('t2', { due_date: '2026-11-21' }), row('t3')], failUpsertFor: '2026-11-21' });

  const result = await connectCalendar(deps, 'u1', 'code-1');

  assertEquals(result, { calendarId: 'cal-new', backfilled: 2, failed: 1 });
  assertEquals([...log.eventIds.keys()], ['t1', 't3']);
});

Deno.test('a rejected code stores nothing', async () => {
  const { deps, log } = fakes();

  await assertRejects(() => connectCalendar(deps, 'u1', 'bad'), Error, 'invalid_grant');
  assertEquals(log.saved, []);
});
