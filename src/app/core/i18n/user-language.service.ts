import { effect, inject, Injectable, untracked } from '@angular/core';
import { AuthService } from '../auth.service';
import { currentUserId } from '../current-user';
import { supabase } from '../supabase-client';
import { browserLanguage, Lang, LANGS } from './i18n';
import { LanguageService } from './language.service';

/**
 * Which language the app speaks:
 *  - before sign-in, the browser's language;
 *  - once signed in, the user's saved language (user_preferences);
 *  - on a user's first sign-in, the browser's language, saved as theirs.
 * Started at app start-up (app.config.ts).
 */
@Injectable({ providedIn: 'root' })
export class UserLanguageService {
  private auth = inject(AuthService);
  private language = inject(LanguageService);
  private loadedFor: string | null = null;

  constructor() {
    this.language.use(browserLanguage());
    effect(() => {
      const userId = this.auth.currentUser()?.id ?? null;
      if (userId === this.loadedFor) return;
      this.loadedFor = userId;
      if (userId) untracked(() => this.applySaved(userId));
    });
  }

  /** Saves the signed-in user's language and switches to it. */
  async save(lang: Lang): Promise<void> {
    const userId = await currentUserId();
    const { error } = await supabase.from('user_preferences').upsert({ user_id: userId, language: lang });
    if (error) throw error;
    this.language.use(lang);
  }

  private async applySaved(userId: string): Promise<void> {
    const { data, error } = await supabase.from('user_preferences').select('language').eq('user_id', userId).maybeSingle();
    if (error) {
      console.error('Could not load the language setting:', error.message);
      return;
    }
    if (data && LANGS.includes(data.language)) {
      this.language.use(data.language);
      return;
    }
    // First sign-in: keep the browser's language, and remember it for the user's other devices.
    const lang = browserLanguage();
    const { error: insertError } = await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, language: lang }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (insertError) console.error('Could not save the language setting:', insertError.message);
    this.language.use(lang);
  }
}
