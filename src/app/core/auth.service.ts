import { Injectable, signal } from '@angular/core';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase-client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private currentUserSignal = signal<User | null>(null);
  currentUser = this.currentUserSignal.asReadonly();

  // Resolves once the stored session (or the one returned by the OAuth redirect)
  // has been restored. Guards wait on this; otherwise a fresh page load would see
  // "no user" for a moment and bounce a signed-in user to /login.
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = supabase.auth.getSession().then(({ data }) => {
      this.currentUserSignal.set(data.session?.user ?? null);
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      this.currentUserSignal.set(session?.user ?? null);
    });
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  async signInWithGoogle(): Promise<void> {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Sign-in asks for basic profile only; Calendar access is a separate opt-in (Settings).
      options: { scopes: 'email profile', redirectTo: window.location.origin },
    });
  }

  /**
   * Local development only (login form is shown when environment.devEmailLogin is true).
   * Production uses Google sign-in exclusively; the hosted project has the Email provider disabled.
   * Returns null on success, or the error message.
   */
  async signInWithPassword(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
    this.currentUserSignal.set(null);
  }
}
