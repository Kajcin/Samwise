import { Injectable, isDevMode } from '@angular/core';
import { provideTransloco, TRANSLOCO_MISSING_HANDLER, TranslocoLoader, TranslocoMissingHandler } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import en from '../../../i18n/en.json';
import cs from '../../../i18n/cs.json';

/** The app's languages; English is the default. Stored per user in user_preferences. */
export type Lang = 'en' | 'cs';
export const LANGS: readonly Lang[] = ['en', 'cs'];

/** How each language calls itself, for the language picker. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', cs: 'Čeština' };

export type Params = Record<string, unknown>;

/** A text to show, translated when it's displayed (so it follows a language switch). */
export interface Message {
  key: string;
  params?: Params;
}

export function msg(key: string, params?: Params): Message {
  return params ? { key, params } : { key };
}

export const TRANSLATIONS: Record<Lang, object> = { en, cs };

/**
 * The language the browser prefers among ours: the first of its preferred languages
 * that is Czech or English; English if it lists neither.
 */
export function browserLanguage(languages: readonly string[] = navigator.languages ?? [navigator.language]): Lang {
  for (const language of languages) {
    const code = language.toLowerCase().split('-')[0];
    if (code === 'cs' || code === 'en') return code;
  }
  return 'en';
}

/** Both languages are bundled, so switching is instant and nothing is fetched. */
@Injectable({ providedIn: 'root' })
export class BundledTranslationLoader implements TranslocoLoader {
  getTranslation(lang: string) {
    return of(TRANSLATIONS[lang as Lang] ?? TRANSLATIONS.en);
  }
}

/**
 * Reached only when a key is in neither language (a Czech gap falls back to English
 * first; i18n.spec.ts checks the files match). That's a bug: in development and
 * tests it throws, so it can't go unnoticed; in production the key is shown.
 */
@Injectable()
export class StrictMissingHandler implements TranslocoMissingHandler {
  handle(key: string): string {
    if (isDevMode()) throw new Error(`Missing translation: ${key}`);
    return key;
  }
}

/**
 * Transloco with ICU message format ({count, plural, one {…} few {…} other {…}}),
 * which Czech needs for its three plural forms. Used by the app and by tests.
 */
export function provideI18n() {
  return [
    provideTransloco({
      config: {
        availableLangs: [...LANGS],
        defaultLang: 'en',
        fallbackLang: 'en',
        reRenderOnLangChange: true,
        missingHandler: { useFallbackTranslation: true, logMissingKey: false },
        prodMode: !isDevMode(),
      },
      loader: BundledTranslationLoader,
    }),
    provideTranslocoMessageformat(),
    { provide: TRANSLOCO_MISSING_HANDLER, useClass: StrictMissingHandler },
  ];
}
