// Google OAuth + Calendar API client shared by the Edge Functions.
// Everything goes to the dedicated "Samwise" calendar (scope calendar.app.created);
// nothing here ever touches the user's primary calendar.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface EventTask {
  due_date: string;
  task_type: string;
  completed_at?: string | null;
  google_calendar_event_id: string | null;
  /** Plant name for generated tasks; null/absent for manual tasks. */
  plant_name?: string | null;
  /** Human-readable place, e.g. "Herbs, row 1 col 2". */
  location?: string | null;
}

/** Google rejected the refresh token (revoked, expired, or the user removed app access). */
export class InvalidGrantError extends Error {
  override name = 'InvalidGrantError';
}

/** The Samwise calendar no longer exists (the user deleted it in Google Calendar). */
export class CalendarGoneError extends Error {
  override name = 'CalendarGoneError';
}

// Keep in sync with TASK_TYPE_LABELS in src/app/plant-catalog/labels.ts.
const TASK_LABELS: Record<string, string> = {
  seed_start: 'Seed start',
  transplant: 'Transplant',
  prune: 'Prune',
  fertilize: 'Fertilize',
  harvest: 'Harvest',
};

/** 404 or 410: the resource doesn't exist (any more). */
function isGone(response: Response): boolean {
  return response.status === 404 || response.status === 410;
}

async function failure(what: string, response: Response): Promise<Error> {
  return new Error(`${what} failed: ${response.status} ${await response.text()}`);
}

function addOneDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function expiresAt(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

function postForm(url: string, params: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

// --- OAuth -------------------------------------------------------------------

export async function exchangeCodeForTokens(code: string, config: GoogleOAuthConfig & { redirectUri: string }) {
  const response = await postForm(TOKEN_URL, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
  if (!response.ok) throw await failure('code exchange', response);
  const json = await response.json();
  // Google only returns a refresh token with access_type=offline (and on re-consent, prompt=consent).
  if (!json.refresh_token) throw new Error('code exchange returned no refresh token');
  return {
    refresh_token: json.refresh_token as string,
    access_token: json.access_token as string,
    expires_at: expiresAt(json.expires_in),
  };
}

export async function refreshAccessToken(refreshToken: string, config: GoogleOAuthConfig) {
  const response = await postForm(TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  });
  if (!response.ok) {
    const text = await response.text();
    if (text.includes('invalid_grant')) throw new InvalidGrantError(text);
    throw new Error(`token refresh failed: ${response.status} ${text}`);
  }
  const json = await response.json();
  return { access_token: json.access_token as string, expires_at: expiresAt(json.expires_in) };
}

/** Revokes the token (and with it the user's grant). An already-invalid token counts as revoked. */
export async function revokeToken(token: string): Promise<void> {
  const response = await postForm(REVOKE_URL, { token });
  if (response.ok) return;
  const text = await response.text();
  if (response.status === 400 && text.includes('invalid_token')) return;
  throw new Error(`token revoke failed: ${response.status} ${text}`);
}

// --- Calendar ------------------------------------------------------------------

function calendarUrl(calendarId: string): string {
  return `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`;
}

/**
 * Returns the stored calendar's id if it still exists; creates a new "Samwise"
 * calendar only when there is none or Google says it's gone (never on other errors,
 * which would leave the user with duplicate calendars).
 */
export async function ensureSamwiseCalendar(accessToken: string, existingCalendarId: string | null): Promise<string> {
  if (existingCalendarId) {
    const existing = await fetch(calendarUrl(existingCalendarId), { headers: authHeaders(accessToken) });
    if (existing.ok) return existingCalendarId;
    if (!isGone(existing)) throw await failure('calendar lookup', existing);
  }
  const created = await fetch(`${CALENDAR_API}/calendars`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ summary: 'Samwise', description: 'Garden care tasks from Samwise' }),
  });
  if (!created.ok) throw await failure('calendar create', created);
  return (await created.json()).id as string;
}

/** Deletes the Samwise calendar; an already-deleted calendar counts as deleted. */
export async function deleteCalendar(accessToken: string, calendarId: string): Promise<void> {
  const response = await fetch(calendarUrl(calendarId), { method: 'DELETE', headers: authHeaders(accessToken) });
  if (!response.ok && !isGone(response)) throw await failure('calendar delete', response);
}

// --- Events ----------------------------------------------------------------------

/** The Google Calendar event for a task: a free (non-blocking) all-day event. */
export function eventBody(task: EventTask) {
  const label = TASK_LABELS[task.task_type] ?? task.task_type;
  const title = task.plant_name ? `${label} — ${task.plant_name}` : label;
  return {
    summary: task.completed_at ? `✓ ${title}` : title,
    description: task.location ?? undefined,
    start: { date: task.due_date },
    end: { date: addOneDay(task.due_date) }, // all-day events use an exclusive end date
    transparency: 'transparent', // don't show garden chores as "busy"
    status: 'confirmed', // revives an event the user deleted in Google (deleted = "cancelled")
  };
}

/** Creates or updates the task's event on the Samwise calendar; returns the event id. */
export async function upsertEvent(accessToken: string, calendarId: string, task: EventTask): Promise<string> {
  const events = `${calendarUrl(calendarId)}/events`;
  const eventId = task.google_calendar_event_id;
  const response = await fetch(eventId ? `${events}/${encodeURIComponent(eventId)}` : events, {
    method: eventId ? 'PATCH' : 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(eventBody(task)),
  });
  if (isGone(response)) {
    // Creating failed: the calendar itself is gone. Updating failed: the event (or the
    // calendar) is gone; recreate the event, which tells the two apart.
    if (!eventId) throw new CalendarGoneError(calendarId);
    return upsertEvent(accessToken, calendarId, { ...task, google_calendar_event_id: null });
  }
  if (!response.ok) throw await failure('event upsert', response);
  return (await response.json()).id as string;
}

/** Deletes a task's event; an already-deleted event counts as deleted. */
export async function deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  const response = await fetch(`${calendarUrl(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken),
  });
  if (!response.ok && !isGone(response)) throw await failure('event delete', response);
}
