import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  CalendarGoneError,
  deleteCalendar,
  deleteEvent,
  ensureSamwiseCalendar,
  eventBody,
  exchangeCodeForTokens,
  InvalidGrantError,
  refreshAccessToken,
  revokeToken,
  upsertEvent,
} from './google.ts';

type Call = { url: string; init?: RequestInit };

/** Replaces fetch with one that returns `responses` in order and records the calls. */
function stubFetch(responses: Response[]): { calls: Call[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch: ${String(input)}`);
    return Promise.resolve(next);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const empty = (status: number) => new Response(null, { status });
const body = (call: Call) => JSON.parse(call.init!.body as string);

const config = { clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'https://app/settings' };
const task = { due_date: '2026-08-20', task_type: 'harvest', google_calendar_event_id: null };

// --- OAuth -------------------------------------------------------------------

Deno.test('exchangeCodeForTokens posts the code to Google and returns tokens with expires_at', async () => {
  const f = stubFetch([json({ refresh_token: 'r-1', access_token: 'a-1', expires_in: 3600 })]);
  try {
    const before = Date.now();
    const result = await exchangeCodeForTokens('auth-code-1', config);
    assertEquals(f.calls[0].url, 'https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(f.calls[0].init!.body as string);
    assertEquals(form.get('code'), 'auth-code-1');
    assertEquals(form.get('grant_type'), 'authorization_code');
    assertEquals(form.get('redirect_uri'), 'https://app/settings');
    assertEquals(result.refresh_token, 'r-1');
    assertEquals(result.access_token, 'a-1');
    const expires = Date.parse(result.expires_at);
    assertEquals(expires >= before + 3600_000 && expires <= Date.now() + 3600_000, true);
  } finally { f.restore(); }
});

Deno.test('exchangeCodeForTokens fails clearly when Google returns no refresh token', async () => {
  const f = stubFetch([json({ access_token: 'a-1', expires_in: 3600 })]);
  try {
    await assertRejects(() => exchangeCodeForTokens('code', config), Error, 'no refresh token');
  } finally { f.restore(); }
});

Deno.test('exchangeCodeForTokens surfaces Google errors', async () => {
  const f = stubFetch([json({ error: 'invalid_grant', error_description: 'Bad Request' }, 400)]);
  try {
    await assertRejects(() => exchangeCodeForTokens('used-code', config), Error, 'invalid_grant');
  } finally { f.restore(); }
});

Deno.test('refreshAccessToken returns a fresh access token', async () => {
  const f = stubFetch([json({ access_token: 'a-2', expires_in: 3599 })]);
  try {
    const result = await refreshAccessToken('r-1', config);
    assertEquals(result.access_token, 'a-2');
    assertEquals(new URLSearchParams(f.calls[0].init!.body as string).get('grant_type'), 'refresh_token');
  } finally { f.restore(); }
});

Deno.test('refreshAccessToken throws InvalidGrantError when Google rejects the refresh token', async () => {
  const f = stubFetch([json({ error: 'invalid_grant' }, 400)]);
  try {
    await assertRejects(() => refreshAccessToken('bad', config), InvalidGrantError);
  } finally { f.restore(); }
});

Deno.test('refreshAccessToken throws a plain error for other failures', async () => {
  const f = stubFetch([json({ error: 'internal_failure' }, 500)]);
  try {
    const error = await assertRejects(() => refreshAccessToken('r-1', config), Error);
    assertEquals(error instanceof InvalidGrantError, false);
  } finally { f.restore(); }
});

Deno.test('revokeToken treats an already-invalid token as revoked', async () => {
  const f = stubFetch([empty(200), json({ error: 'invalid_token' }, 400)]);
  try {
    await revokeToken('r-1');
    await revokeToken('r-already-revoked');
    assertEquals(f.calls[0].url, 'https://oauth2.googleapis.com/revoke');
    assertEquals(new URLSearchParams(f.calls[0].init!.body as string).get('token'), 'r-1');
  } finally { f.restore(); }
});

// --- Calendar ------------------------------------------------------------------

Deno.test('ensureSamwiseCalendar reuses the stored calendar when it still exists', async () => {
  const f = stubFetch([json({ id: 'cal-1' })]);
  try {
    assertEquals(await ensureSamwiseCalendar('tok', 'cal-1'), 'cal-1');
    assertEquals(f.calls.length, 1);
    assertEquals(f.calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars/cal-1');
    assertEquals((f.calls[0].init!.headers as Record<string, string>).Authorization, 'Bearer tok');
  } finally { f.restore(); }
});

Deno.test('ensureSamwiseCalendar creates a "Samwise" calendar when the stored one is gone', async () => {
  const f = stubFetch([empty(404), json({ id: 'cal-new' })]);
  try {
    assertEquals(await ensureSamwiseCalendar('tok', 'cal-old'), 'cal-new');
    assertEquals(f.calls[1].url, 'https://www.googleapis.com/calendar/v3/calendars');
    assertEquals(f.calls[1].init!.method, 'POST');
    assertEquals(body(f.calls[1]).summary, 'Samwise');
  } finally { f.restore(); }
});

Deno.test('ensureSamwiseCalendar creates a calendar when none is stored', async () => {
  const f = stubFetch([json({ id: 'cal-new' })]);
  try {
    assertEquals(await ensureSamwiseCalendar('tok', null), 'cal-new');
    assertEquals(f.calls.length, 1);
  } finally { f.restore(); }
});

Deno.test('ensureSamwiseCalendar does not create a duplicate when the check fails for another reason', async () => {
  const f = stubFetch([empty(503)]);
  try {
    await assertRejects(() => ensureSamwiseCalendar('tok', 'cal-1'), Error, '503');
    assertEquals(f.calls.length, 1);
  } finally { f.restore(); }
});

Deno.test('deleteCalendar treats an already-deleted calendar as deleted, and reports other failures', async () => {
  const f = stubFetch([empty(204), empty(404), empty(401)]);
  try {
    await deleteCalendar('tok', 'cal-1');
    await deleteCalendar('tok', 'cal-gone');
    await assertRejects(() => deleteCalendar('tok', 'cal-1'), Error, '401');
    assertEquals(f.calls[0].init!.method, 'DELETE');
  } finally { f.restore(); }
});

// --- Events ----------------------------------------------------------------------

Deno.test('eventBody makes a free all-day event titled with the task and plant', () => {
  const event = eventBody({
    ...task, plant_name: 'Tomato', location: 'Herbs, row 1 col 2', completed_at: null,
  });
  assertEquals(event.summary, 'Harvest — Tomato');
  assertEquals(event.description, 'Herbs, row 1 col 2');
  assertEquals(event.start, { date: '2026-08-20' });
  assertEquals(event.end, { date: '2026-08-21' }); // exclusive end date
  assertEquals(event.transparency, 'transparent');
  assertEquals(event.status, 'confirmed');
});

Deno.test('eventBody marks completed tasks and handles month ends', () => {
  const event = eventBody({ ...task, due_date: '2026-12-31', completed_at: '2026-12-31T10:00:00Z' });
  assertEquals(event.summary, '✓ Harvest');
  assertEquals(event.end, { date: '2027-01-01' });
});

Deno.test('upsertEvent POSTs a new event to the Samwise calendar, never primary', async () => {
  const f = stubFetch([json({ id: 'evt-1' })]);
  try {
    assertEquals(await upsertEvent('tok', 'cal-1', task), 'evt-1');
    assertEquals(f.calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars/cal-1/events');
    assertEquals(f.calls[0].init!.method, 'POST');
    assertEquals(body(f.calls[0]).start, { date: '2026-08-20' });
  } finally { f.restore(); }
});

Deno.test('upsertEvent PATCHes an existing event and revives it if it was deleted in Google', async () => {
  const f = stubFetch([json({ id: 'evt-1' })]);
  try {
    await upsertEvent('tok', 'cal-1', { ...task, google_calendar_event_id: 'evt-1' });
    assertEquals(f.calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars/cal-1/events/evt-1');
    assertEquals(f.calls[0].init!.method, 'PATCH');
    assertEquals(body(f.calls[0]).status, 'confirmed');
  } finally { f.restore(); }
});

Deno.test('upsertEvent recreates an event that no longer exists', async () => {
  const f = stubFetch([empty(410), json({ id: 'evt-2' })]);
  try {
    assertEquals(await upsertEvent('tok', 'cal-1', { ...task, google_calendar_event_id: 'evt-1' }), 'evt-2');
    assertEquals(f.calls[1].init!.method, 'POST');
  } finally { f.restore(); }
});

Deno.test('upsertEvent throws CalendarGoneError when the Samwise calendar was deleted', async () => {
  const f = stubFetch([empty(404)]);
  try {
    await assertRejects(() => upsertEvent('tok', 'cal-1', task), CalendarGoneError);
  } finally { f.restore(); }
});

Deno.test('upsertEvent reports other failures with the status', async () => {
  const f = stubFetch([json({ error: { message: 'Rate Limit Exceeded' } }, 403)]);
  try {
    const error = await assertRejects(() => upsertEvent('tok', 'cal-1', task), Error);
    assertStringIncludes(error.message, '403');
    assertEquals(error instanceof CalendarGoneError, false);
  } finally { f.restore(); }
});

Deno.test('deleteEvent treats an already-deleted event as deleted, and reports other failures', async () => {
  const f = stubFetch([empty(204), empty(410), empty(500)]);
  try {
    await deleteEvent('tok', 'cal-1', 'evt-1');
    await deleteEvent('tok', 'cal-1', 'evt-gone');
    await assertRejects(() => deleteEvent('tok', 'cal-1', 'evt-1'), Error, '500');
    assertEquals(f.calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars/cal-1/events/evt-1');
  } finally { f.restore(); }
});
