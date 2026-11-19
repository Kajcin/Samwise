import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import type { User } from '@supabase/supabase-js';
import { googleAuthUrl, OAUTH_STATE_KEY, parseOAuthRedirect, SettingsComponent } from './settings.component';
import { CalendarConnectError, CalendarService } from './calendar.service';
import { AuthService } from '../core/auth.service';

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

  async function render(queryParams: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
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
    calendar = jasmine.createSpyObj<CalendarService>('CalendarService', ['isConnected', 'connect']);
    calendar.isConnected.and.resolveTo(false);
  });

  afterEach(() => sessionStorage.removeItem(OAUTH_STATE_KEY));

  it('shows the account and a Connect button when not connected', async () => {
    const { el } = await render();

    expect(el.textContent).toContain('me@example.com');
    expect(el.textContent).toContain('Not connected');
    expect(el.querySelector('button')!.textContent).toContain('Connect Google Calendar');
  });

  it('shows the connection when connected', async () => {
    calendar.isConnected.and.resolveTo(true);
    const { el } = await render();

    expect(el.textContent).toContain('Connected');
    expect(el.querySelector('button')).toBeNull();
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
    calendar.isConnected.and.resolveTo(true);
    const { el } = await render({ code: 'c-1', state: 'state-1' });

    expect(calendar.connect).toHaveBeenCalledWith('c-1');
    // The status is checked once, after connecting finished.
    expect(calendar.isConnected).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith([], { queryParams: {}, replaceUrl: true });
    expect(sessionStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
    expect(el.querySelector('[role=status]')!.textContent).toContain('5 upcoming tasks');
    expect(el.textContent).toContain('Connected');
  });

  it('explains when the user declined in Google', async () => {
    sessionStorage.setItem(OAUTH_STATE_KEY, 'state-1');
    const { el } = await render({ error: 'access_denied', state: 'state-1' });

    expect(calendar.connect).not.toHaveBeenCalled();
    expect(el.querySelector('[role=alert]')!.textContent).toContain("didn't allow calendar access");
  });

  it('refuses a response whose state does not match', async () => {
    sessionStorage.setItem(OAUTH_STATE_KEY, 'state-1');
    const { el } = await render({ code: 'c-1', state: 'forged' });

    expect(calendar.connect).not.toHaveBeenCalled();
    expect(el.querySelector('[role=alert]')!.textContent).toContain("didn't match");
  });

  it('shows a friendly message when connecting fails', async () => {
    sessionStorage.setItem(OAUTH_STATE_KEY, 'state-1');
    calendar.connect.and.rejectWith(new CalendarConnectError('google_rejected_code'));
    const { el } = await render({ code: 'c-1', state: 'state-1' });

    expect(el.querySelector('[role=alert]')!.textContent).toContain('Google didn’t accept');
  });
});
