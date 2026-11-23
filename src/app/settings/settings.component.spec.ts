import { provideI18n } from '../core/i18n/i18n';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import type { User } from '@supabase/supabase-js';
import { googleAuthUrl, OAUTH_STATE_KEY, parseOAuthRedirect, SettingsComponent } from './settings.component';
import { CalendarError, CalendarService } from './calendar.service';
import { AuthService } from '../core/auth.service';
import { UserLanguageService } from '../core/i18n/user-language.service';
import { LanguageService } from '../core/i18n/language.service';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';

describe('parseOAuthRedirect', () => {
  it('returns null when the URL has no OAuth params', () => {
    expect(parseOAuthRedirect(new URLSearchParams(''), 'state-1')).toBeNull();
  });

  it('returns the code when state matches', () => {
    expect(parseOAuthRedirect(new URLSearchParams('code=c-1&state=state-1'), 'state-1')).toEqual({ code: 'c-1' });
  });

  it('rejects a mismatched or missing state', () => {
    expect(parseOAuthRedirect(new URLSearchParams('code=c-1&state=other'), 'state-1')).toEqual({ error: 'state_mismatch' });
    expect(parseOAuthRedirect(new URLSearchParams('code=c-1&state=state-1'), null)).toEqual({ error: 'state_mismatch' });
  });

  it('passes through an error returned by Google', () => {
    expect(parseOAuthRedirect(new URLSearchParams('error=access_denied&state=state-1'), 'state-1')).toEqual({ error: 'access_denied' });
  });
});

describe('googleAuthUrl', () => {
  it('asks only for the Samwise-calendar scope, offline, with forced consent', () => {
    const url = new URL(googleAuthUrl('client-1', 'http://localhost:4200/settings', 'state-1'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-1',
      redirect_uri: 'http://localhost:4200/settings',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: 'https://www.googleapis.com/auth/calendar.app.created',
      state: 'state-1',
    });
  });
});

describe('SettingsComponent', () => {
  let calendar: jasmine.SpyObj<CalendarService>;
  let navigate: jasmine.Spy;
  let userLanguage: jasmine.SpyObj<UserLanguageService>;
  let dialog: jasmine.SpyObj<ConfirmDialogService>;

  async function render(queryParams: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideI18n(),
        { provide: UserLanguageService, useValue: userLanguage },
        { provide: ConfirmDialogService, useValue: dialog },
        provideRouter([]),
        { provide: CalendarService, useValue: calendar },
        { provide: AuthService, useValue: { currentUser: signal({ email: 'me@example.com' } as User) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    });
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    calendar = jasmine.createSpyObj<CalendarService>('CalendarService', ['status', 'connect', 'disconnect']);
    calendar.status.and.resolveTo('not_connected');
    userLanguage = jasmine.createSpyObj<UserLanguageService>('UserLanguageService', ['save']);
    dialog = jasmine.createSpyObj<ConfirmDialogService>('ConfirmDialogService', ['ask']);
    dialog.ask.and.resolveTo(true);
    // Like the real service: saving switches the app's language.
    userLanguage.save.and.callFake(async (lang) => TestBed.inject(LanguageService).use(lang));
  });

  afterEach(() => sessionStorage.removeItem(OAUTH_STATE_KEY));

  it('shows the account and a Connect button when not connected', async () => {
    const { el } = await render();

    expect(el.textContent).toContain('me@example.com');
    expect(el.textContent).toContain('Not connected');
    expect(el.querySelector('button')!.textContent).toContain('Connect Google Calendar');
  });

  it('offers English and Czech, showing the current language', async () => {
    const { el } = await render();
    const select = el.querySelector<HTMLSelectElement>('select[name=language]')!;

    expect(Array.from(select.options).map((o) => o.textContent!.trim())).toEqual(['English', 'Čeština']);
    expect(select.value).toBe('en');
  });

  it('switches to Czech: saves it for the account and translates the page', async () => {
    const { fixture, el } = await render();
    const select = el.querySelector<HTMLSelectElement>('select[name=language]')!;

    select.value = 'cs';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(userLanguage.save).toHaveBeenCalledWith('cs');
    expect(el.querySelector('h1')!.textContent).toContain('Nastavení');
    expect(el.querySelector('.language [role=status]')!.textContent).toContain('Jazyk byl uložen.');
    expect(el.querySelector('button.connect')!.textContent).toContain('Připojit Kalendář Google');
  });

  it('mentions the calendar when a connected user changes language', async () => {
    calendar.status.and.resolveTo('connected');
    const { fixture, el } = await render();
    const select = el.querySelector<HTMLSelectElement>('select[name=language]')!;

    select.value = 'cs';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.language [role=status]')!.textContent).toContain('Události ve vašem kalendáři');
  });

  it('shows an error when the language could not be saved', async () => {
    userLanguage.save.and.rejectWith(new Error('offline'));
    const { fixture, el } = await render();
    const select = el.querySelector<HTMLSelectElement>('select[name=language]')!;

    select.value = 'cs';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.language [role=alert]')!.textContent).toContain('Couldn’t save the language: offline');
  });

  it('shows the connection and a Disconnect button when connected', async () => {
    calendar.status.and.resolveTo('connected');
    const { el } = await render();

    expect(el.textContent).toContain('New and changed tasks appear');
    expect(el.querySelector('button.connect')).toBeNull();
    expect(el.querySelector('button.disconnect')!.textContent).toContain('Disconnect');
  });

  it('explains a revoked connection and offers to reconnect', async () => {
    calendar.status.and.resolveTo('revoked');
    const { el } = await render();

    expect(el.querySelector('.reconnect')!.textContent).toContain('access to your Google Calendar was removed');
    expect(el.querySelector('button.connect')!.textContent).toContain('Reconnect Google Calendar');
    expect(el.querySelector('button.disconnect')).not.toBeNull();
  });

  it('explains a deleted calendar and offers to reconnect', async () => {
    calendar.status.and.resolveTo('calendar_deleted');
    const { el } = await render();

    expect(el.querySelector('.reconnect')!.textContent).toContain('calendar was deleted in Google Calendar');
    expect(el.querySelector('button.connect')!.textContent).toContain('Reconnect Google Calendar');
  });

  it('disconnects after confirmation and shows the result', async () => {
    calendar.status.and.resolveTo('connected');
    calendar.disconnect.and.resolveTo({ calendarDeleted: true });
    const { fixture, component, el } = await render();
    calendar.status.and.resolveTo('not_connected');

    (el.querySelector('button.disconnect') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const asked = dialog.ask.calls.mostRecent().args[0];
    expect(asked.title).toBe('Disconnect Google Calendar?');
    expect(asked.message).toContain('deletes your “Samwise” calendar');
    expect(asked.danger).toBeTrue();
    expect(calendar.disconnect).toHaveBeenCalled();
    expect(el.querySelector('[role=status]')!.textContent).toContain('your “Samwise” calendar was deleted');
    expect(el.textContent).toContain('Not connected');
  });

  it('says so when the calendar could not be deleted', async () => {
    calendar.status.and.resolveTo('revoked');
    calendar.disconnect.and.resolveTo({ calendarDeleted: false });
    const { fixture, component, el } = await render();

    (el.querySelector('button.disconnect') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('[role=status]')!.textContent).toContain('delete it in Google Calendar');
  });

  it('does nothing when the confirmation is cancelled', async () => {
    calendar.status.and.resolveTo('connected');
    const { component, el } = await render();
    dialog.ask.and.resolveTo(false);

    (el.querySelector('button.disconnect') as HTMLButtonElement).click();

    expect(calendar.disconnect).not.toHaveBeenCalled();
  });

  it("says when Samwise's server can't be reached while disconnecting", async () => {
    calendar.status.and.resolveTo('connected');
    calendar.disconnect.and.rejectWith(new CalendarError('unreachable'));
    const { fixture, component, el } = await render();

    (el.querySelector('button.disconnect') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const alert = el.querySelector('[role=alert]')!.textContent!;
    expect(alert).toContain('Samwise’s server couldn’t be reached, so Google Calendar is still connected');
    expect(alert).toContain('npx supabase functions serve'); // tests run with the development environment
  });

  it("says when Samwise's server can't be reached while connecting", async () => {
    sessionStorage.setItem(OAUTH_STATE_KEY, 'state-1');
    calendar.connect.and.rejectWith(new CalendarError('unreachable'));
    const { el } = await render({ code: 'c-1', state: 'state-1' });

    expect(el.querySelector('[role=alert]')!.textContent).toContain('so Google Calendar wasn’t connected');
  });

  it('shows an error when disconnecting fails, and stays connected', async () => {
    calendar.status.and.resolveTo('connected');
    calendar.disconnect.and.rejectWith(new CalendarError('disconnect_failed'));
    const { fixture, component, el } = await render();

    (el.querySelector('button.disconnect') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('Couldn’t disconnect');
    expect(el.textContent).toContain('New and changed tasks appear');
  });

  it('sends the user to Google with a fresh state remembered for the return', async () => {
    const { component, el } = await render();
    const redirect = spyOn(component as any, 'redirectTo');

    el.querySelector('button')!.click();

    const url = new URL(redirect.calls.mostRecent().args[0] as string);
    expect(url.hostname).toBe('accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe(`${window.location.origin}/settings`);
    expect(url.searchParams.get('state')).toBe(sessionStorage.getItem(OAUTH_STATE_KEY));
  });

  it('finishes connecting when Google returns a code, then cleans the URL', async () => {
    sessionStorage.setItem(OAUTH_STATE_KEY, 'state-1');
    calendar.connect.and.resolveTo({ backfilled: 5, failed: 0 });
    calendar.status.and.resolveTo('connected');
    const { el } = await render({ code: 'c-1', state: 'state-1' });

    expect(calendar.connect).toHaveBeenCalledWith('c-1');
    // The status is checked once, after connecting finished.
    expect(calendar.status).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith([], { queryParams: {}, replaceUrl: true });
    expect(sessionStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
    expect(el.querySelector('[role=status]')!.textContent).toContain('5 upcoming tasks');
    expect(el.textContent).toContain('Connected');
  });

  it('explains when the user declined in Google', async () => {
    sessionStorage.setItem(OAUTH_STATE_KEY, 'state-1');
    const { el } = await render({ error: 'access_denied', state: 'state-1' });

    expect(calendar.connect).not.toHaveBeenCalled();
    expect(el.querySelector('[role=alert]')!.textContent).toContain('didn’t allow calendar access');
  });

  it('refuses a response whose state does not match', async () => {
    sessionStorage.setItem(OAUTH_STATE_KEY, 'state-1');
    const { el } = await render({ code: 'c-1', state: 'forged' });

    expect(calendar.connect).not.toHaveBeenCalled();
    expect(el.querySelector('[role=alert]')!.textContent).toContain('didn’t match');
  });

  it('shows a friendly message when connecting fails', async () => {
    sessionStorage.setItem(OAUTH_STATE_KEY, 'state-1');
    calendar.connect.and.rejectWith(new CalendarError('google_rejected_code'));
    const { el } = await render({ code: 'c-1', state: 'state-1' });

    expect(el.querySelector('[role=alert]')!.textContent).toContain('Google didn’t accept');
  });
});
