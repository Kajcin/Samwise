import { Component, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { environment } from '../../environments/environment';
import { CalendarError, CalendarService, CalendarStatus } from './calendar.service';
import { messageOf } from '../core/errors';
import { Lang, LANG_NAMES, LANGS, Message, msg } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';
import { UserLanguageService } from '../core/i18n/user-language.service';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';

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
function unreachable(key: 'unreachableConnect' | 'unreachableDisconnect'): Message[] {
  const message = msg(`settings.calendar.errors.${key}`);
  return environment.production ? [message] : [message, msg('settings.calendar.errors.devHint')];
}

/** Codes from Google's redirect or the connect-calendar function that have their own text. */
const CONNECT_ERRORS = new Set(['access_denied', 'state_mismatch', 'google_rejected_code']);

export function connectErrorMessage(code: string): Message[] {
  if (code === 'unreachable') return unreachable('unreachableConnect');
  return [msg(CONNECT_ERRORS.has(code) ? `settings.calendar.errors.${code}` : 'settings.calendar.errors.connectFailed')];
}

/** Why syncing stopped, for a connection that broke on Google's side. */
export const RECONNECT_MESSAGES: Partial<Record<CalendarStatus, string>> = {
  revoked: 'settings.calendar.reconnectRevoked',
  calendar_deleted: 'settings.calendar.reconnectDeleted',
};

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './settings.component.html',
})
export class SettingsComponent {
  protected auth = inject(AuthService);
  private calendar = inject(CalendarService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private userLanguage = inject(UserLanguageService);
  private confirmDialog = inject(ConfirmDialogService);
  protected i18n = inject(LanguageService);

  protected readonly languages = LANGS;
  protected readonly languageNames = LANG_NAMES;
  languageStatus = signal<Message | null>(null);
  languageError = signal<Message | null>(null);
  savingLanguage = signal(false);

  /** null while checking. */
  connection = signal<CalendarStatus | null>(null);
  reconnectMessage = computed(() => {
    const key = RECONNECT_MESSAGES[this.connection() ?? 'connected'];
    return key ? this.i18n.t(key) : '';
  });
  busy = signal(false);
  status = signal<Message[] | null>(null);
  error = signal<Message[] | null>(null);

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
      this.error.set([msg('settings.calendar.errors.check', { detail: messageOf(e) })]);
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

  async changeLanguage(value: string): Promise<void> {
    const lang = value as Lang;
    if (!LANGS.includes(lang) || lang === this.i18n.lang()) return;
    this.languageStatus.set(null);
    this.languageError.set(null);
    this.savingLanguage.set(true);
    try {
      await this.userLanguage.save(lang);
      // Event titles are in the user's language; the database re-syncs them (migration 0009).
      this.languageStatus.set(
        msg(this.connection() === 'connected' ? 'settings.language.savedCalendar' : 'settings.language.saved'),
      );
    } catch (e) {
      this.languageError.set(msg('settings.language.error', { detail: messageOf(e) }));
    } finally {
      this.savingLanguage.set(false);
    }
  }

  async disconnectCalendar(): Promise<void> {
    const deletesCalendar = this.connection() === 'connected';
    const confirmed = await this.confirmDialog.ask({
      title: this.i18n.t('settings.calendar.disconnectTitle'),
      message: this.i18n.t(
        deletesCalendar ? 'settings.calendar.confirmDisconnect' : 'settings.calendar.confirmDisconnectBroken',
      ),
      confirmLabel: this.i18n.t('settings.calendar.disconnect'),
      cancelLabel: this.i18n.t('common.cancel'),
      danger: deletesCalendar,
      confirmIcon: 'calendar-x',
    });
    if (!confirmed) return;

    this.status.set(null);
    this.error.set(null);
    this.busy.set(true);
    try {
      const { calendarDeleted } = await this.calendar.disconnect();
      this.status.set([
        msg(calendarDeleted ? 'settings.calendar.disconnected' : 'settings.calendar.disconnectedKept'),
      ]);
    } catch (e) {
      this.error.set(
        e instanceof CalendarError && e.code === 'unreachable'
          ? unreachable('unreachableDisconnect')
          : [msg('settings.calendar.errors.disconnectFailed')],
      );
    } finally {
      this.busy.set(false);
    }
    await this.refreshStatus();
  }


  private async finishConnect(code: string): Promise<void> {
    this.busy.set(true);
    try {
      const { backfilled, failed } = await this.calendar.connect(code);
      this.status.set([
        msg('settings.calendar.connectedStatus', { count: backfilled }),
        ...(failed ? [msg('settings.calendar.connectedFailed', { count: failed })] : []),
      ]);
    } catch (e) {
      this.error.set(connectErrorMessage(e instanceof CalendarError ? e.code : 'connect_failed'));
    } finally {
      this.busy.set(false);
    }
  }
}
