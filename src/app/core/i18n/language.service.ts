import { DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Lang, LANGS, Message, Params } from './i18n';

function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && typeof (value as Message).key === 'string';
}

/**
 * The current language and translation. `t()` reads the language signal, so
 * templates (and computed signals) that translate re-render on a switch.
 *
 * Which language a user gets is decided by UserLanguageService.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private transloco = inject(TranslocoService);
  private document = inject(DOCUMENT);
  private current = signal<Lang>('en');
  readonly lang = this.current.asReadonly();

  constructor() {
    // The loader is synchronous (bundled JSON), so both languages are ready right away.
    for (const lang of LANGS) this.transloco.load(lang).subscribe();
  }

  use(lang: Lang): void {
    // Transloco's active language also sets the plural rules of the message format.
    this.transloco.setActiveLang(lang);
    this.current.set(lang);
    this.document.documentElement.lang = lang;
  }

  /** A parameter may itself be a Message: it's translated first ("early {month}" → "early May"). */
  t(key: string, params?: Params): string {
    this.current(); // track the language
    return this.transloco.translate(key, params ? this.resolve(params) : {});
  }

  private resolve(params: Params): Params {
    const out: Params = {};
    for (const [name, value] of Object.entries(params)) {
      out[name] = isMessage(value) ? this.t(value.key, value.params) : value;
    }
    return out;
  }

  /**
   * Translates a Message, or several as one text (sentences joined by a space);
   * null stays null (for optional messages in templates).
   */
  text(message: Message | readonly Message[] | null): string | null {
    if (!message) return null;
    const messages: readonly Message[] = Array.isArray(message) ? message : [message as Message];
    return messages.map((m) => this.t(m.key, m.params)).join(' ');
  }
}
