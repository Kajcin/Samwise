import { provideI18n } from './core/i18n/i18n';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { User } from '@supabase/supabase-js';
import { App } from './app';
import { AuthService } from './core/auth.service';

describe('App', () => {
  const user = signal<User | null>(null);
  let auth: { currentUser: typeof user; signOut: jasmine.Spy };

  beforeEach(async () => {
    user.set(null);
    auth = { currentUser: user, signOut: jasmine.createSpy('signOut').and.resolveTo() };
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideI18n(), provideRouter([]), { provide: AuthService, useValue: auth }],
    }).compileComponents();
  });

  it('hides the navigation when signed out', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
  });

  it('shows the navigation and the user when signed in', async () => {
    user.set({ email: 'dev@samwise.local' } as User);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const nav = fixture.nativeElement.querySelector('nav') as HTMLElement;

    expect(Array.from(nav.querySelectorAll('.navbar-nav a')).map((a) => a.textContent!.trim())).toEqual(['Dashboard', 'Tasks', 'Garden', 'Plant catalog', 'Settings']);
    expect(nav.textContent).toContain('dev@samwise.local');
  });

  it('shows the logo next to the name, as decoration (the name says it)', async () => {
    user.set({ email: 'dev@samwise.local' } as User);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const brand = fixture.nativeElement.querySelector('.navbar-brand') as HTMLElement;

    const logo = brand.querySelector('img')!;
    expect(logo.getAttribute('src')).toBe('logo-mark.svg');
    expect(logo.getAttribute('alt')).toBe('');
    expect(brand.textContent!.trim()).toBe('Samwise');
  });

  it('leads home when the logo is clicked, closing the menu on phones', async () => {
    user.set({ email: 'dev@samwise.local' } as User);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    (el.querySelector('.navbar-toggler') as HTMLButtonElement).click();
    fixture.detectChanges();

    const brand = el.querySelector<HTMLAnchorElement>('a.navbar-brand')!;
    expect(brand.getAttribute('href')).toBe('/');
    brand.click();
    fixture.detectChanges();

    expect(navigate.calls.mostRecent().args[0].toString()).toBe('/');
    expect(el.querySelector('#app-menu')!.classList).not.toContain('show');
  });

  it('opens and closes the menu on narrow screens', async () => {
    user.set({ email: 'dev@samwise.local' } as User);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const toggler = el.querySelector('.navbar-toggler') as HTMLButtonElement;
    const menu = el.querySelector('#app-menu')!;

    expect(menu.classList).not.toContain('show');
    toggler.click();
    fixture.detectChanges();
    expect(menu.classList).toContain('show');
    expect(toggler.getAttribute('aria-expanded')).toBe('true');

    (menu.querySelector('a') as HTMLAnchorElement).click(); // picking a page closes it
    fixture.detectChanges();
    expect(menu.classList).not.toContain('show');
  });

  it('signs out and returns to the login page', async () => {
    user.set({ email: 'dev@samwise.local' } as User);
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('nav button.sign-out') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(auth.signOut).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
