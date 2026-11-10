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
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
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

    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.textContent!.trim())).toEqual(['Dashboard', 'Tasks', 'Garden', 'Plant catalog']);
    expect(nav.textContent).toContain('dev@samwise.local');
  });

  it('signs out and returns to the login page', async () => {
    user.set({ email: 'dev@samwise.local' } as User);
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('nav button') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(auth.signOut).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
