import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { environment } from '../../environments/environment';
import { CalendarError, CalendarService, CalendarStatus } from './calendar.service';
import { messageOf } from '../core/errors';

/** Lets Samwise create its own calendars and manage their events, nothing else. */
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const OAUTH_STATE_KEY = 'samwise.calendarOAuthState';

type QueryParams = { get(name: string): string | null };

/** Reads Google's redirect back to /settings; the state must match the one we sent (CSRF check). */
export function parseOAuthRedirect(
  params: QueryParams,
  expectedState: string | null,
): { code: string } | { error: string } | null {
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return null;
  if (!expectedState || params.get('state') !== expectedState) return { error: 'state_mismatch' };
  if (error) return { error };
  return { code: code! };
}

export function googleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline', // we need a refresh token for background sync
    prompt: 'consent', // Google only returns a refresh token on consent, so ask every time
    scope: GOOGLE_CALENDAR_SCOPE,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Shown when Samwise's server (the Edge Functions) didn't answer, so nothing changed. */
export function unreachableMessage(outcome: string): string {
  return (
    `Samwise’s server couldn’t be reached, so ${outcome}. Please try again in a moment.` +
    (environment.production ? '' : ' (Local development: is “npx supabase functions serve” running?)')
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  unreachable: unreachableMessage('Google Calendar wasn’t connected'),
  access_denied: "You didn't allow calendar access, so nothing was connected.",
  state_mismatch: "Google's response didn't match this browser session. Please try connecting again.",
  google_rejected_code: 'Google didn’t accept the sign-in (it may have expired). Please try connecting again.',
};

function connectErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? 'Couldn’t connect Google Calendar. Please try again.';
}

/** Why syncing stopped, for a connection that broke on Google's side. */
export const RECONNECT_MESSAGES: Partial<Record<CalendarStatus, string>> = {
  revoked:
    'Samwise’s access to your Google Calendar was removed in your Google account, so tasks aren’t syncing. ' +
    'Reconnect to resume; your “Samwise” calendar will be reused.',
  calendar_deleted:
    'Your “Samwise” calendar was deleted in Google Calendar, so tasks aren’t syncing. Reconnect to create it again.',
};

@Component({
  selector: 'app-settings',
  standalone: true,
  templateUrl: './settings.component.html',
})
export class SettingsComponent {
  protected auth = inject(AuthService);
  private calendar = inject(CalendarService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  /** null while checking. */
  connection = signal<CalendarStatus | null>(null);
  reconnectMessage = computed(() => RECONNECT_MESSAGES[this.connection() ?? 'connected'] ?? '');
  busy = signal(false);
  status = signal<string | null>(null);
  error = signal<string | null>(null);

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    const redirect = parseOAuthRedirect(this.route.snapshot.queryParamMap, sessionStorage.getItem(OAUTH_STATE_KEY));
    if (redirect) {
      sessionStorage.removeItem(OAUTH_STATE_KEY);
      // Drop ?code=…&state=… from the address bar (the code is single-use anyway).
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
      if ('code' in redirect) await this.finishConnect(redirect.code);
      else this.error.set(connectErrorMessage(redirect.error));
    }
    await this.refreshStatus();
  }

  private async refreshStatus(): Promise<void> {
    try {
      this.connection.set(await this.calendar.status());
    } catch (e) {
      this.error.set(`Couldn’t check the calendar connection: ${messageOf(e)}`);
    }
  }

  connectCalendar(): void {
    this.status.set(null);
    this.error.set(null);
    this.busy.set(true);
    const state = crypto.randomUUID();
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
    this.redirectTo(googleAuthUrl(environment.googleClientId, `${window.location.origin}/settings`, state));
  }

  /** Separate so tests can intercept the full-page navigation. */
  protected redirectTo(url: string): void {
    window.location.assign(url);
  }

  async disconnectCalendar(): Promise<void> {
    const deletesCalendar = this.connection() === 'connected';
    const question = deletesCalendar
      ? 'Disconnect Google Calendar? This deletes your “Samwise” calendar and all its events from Google Calendar.'
      : 'Disconnect Google Calendar?';
    if (!this.confirm(question)) return;

    this.status.set(null);
    this.error.set(null);
    this.busy.set(true);
    try {
      const { calendarDeleted } = await this.calendar.disconnect();
      this.status.set(
        calendarDeleted
          ? 'Google Calendar disconnected, and your “Samwise” calendar was deleted.'
          : 'Google Calendar disconnected. Samwise no longer had access to delete your “Samwise” calendar, ' +
              'so delete it in Google Calendar if you don’t want it.',
      );
    } catch (e) {
      this.error.set(
        e instanceof CalendarError && e.code === 'unreachable'
          ? unreachableMessage('Google Calendar is still connected')
          : 'Couldn’t disconnect Google Calendar. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
    await this.refreshStatus();
  }

  /** Separate so tests can answer the confirmation dialog. */
  protected confirm(question: string): boolean {
    return window.confirm(question);
  }

  private async finishConnect(code: string): Promise<void> {
    this.busy.set(true);
    try {
      const { backfilled, failed } = await this.calendar.connect(code);
      const synced = backfilled === 1 ? '1 upcoming task is' : `${backfilled} upcoming tasks are`;
      this.status.set(
        `Google Calendar connected. ${synced} on your “Samwise” calendar.` +
          (failed ? ` ${failed} couldn’t be added yet and will sync when they next change.` : ''),
      );
    } catch (e) {
      this.error.set(connectErrorMessage(e instanceof CalendarError ? e.code : 'connect_failed'));
    } finally {
      this.busy.set(false);
    }
  }
}
