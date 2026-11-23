import { TestBed } from '@angular/core/testing';
import MessageFormat from '@messageformat/core';
import { parse, Token } from '@messageformat/parser';
import { browserLanguage, LANGS, provideI18n, TRANSLATIONS } from './i18n';
import { LanguageService } from './language.service';

type Tree = { [key: string]: string | Tree };

/** Every text in a translation file, by its dotted key. */
function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

/** The arguments a message uses ({name}, {count, plural, …}), from the ICU parser. */
function placeholders(message: string): string[] {
  const args = new Set<string>();
  const visit = (tokens: Token[]) => {
    for (const token of tokens) {
      if ('arg' in token) args.add(token.arg);
      if ('cases' in token) for (const c of token.cases) visit(c.tokens);
    }
  };
  visit(parse(message));
  return [...args].sort();
}

const en = leaves(TRANSLATIONS.en as Tree);
const cs = leaves(TRANSLATIONS.cs as Tree);

describe('translation files', () => {
  it('have the same keys in English and Czech', () => {
    expect([...cs.keys()].filter((k) => !en.has(k))).withContext('only in cs.json').toEqual([]);
    expect([...en.keys()].filter((k) => !cs.has(k))).withContext('only in en.json').toEqual([]);
  });

  it('use the same placeholders in both languages', () => {
    for (const [key, text] of en) {
      expect(placeholders(cs.get(key) ?? '')).withContext(key).toEqual(placeholders(text));
    }
  });

  it('are valid ICU messages', () => {
    for (const lang of LANGS) {
      const mf = new MessageFormat(lang);
      for (const [key, text] of lang === 'en' ? en : cs) {
        expect(() => mf.compile(text)).withContext(`${lang}: ${key}`).not.toThrow();
      }
    }
  });

  it('give every Czech plural its "few" form (2-4)', () => {
    for (const [key, text] of cs) {
      if (/plural,/.test(text) && /\bone\s*\{/.test(text) && !/\bfew\s*\{/.test(text)) {
        // Allowed only where the "few" form is the same as "other" (e.g. "z # políček").
        expect(['dashboard.nothingToDo', 'dashboard.cellsPlanted']).withContext(key).toContain(key);
      }
    }
  });
});

describe('LanguageService', () => {
  let i18n: LanguageService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideI18n()] });
    i18n = TestBed.inject(LanguageService);
  });

  it('speaks English until told otherwise', () => {
    expect(i18n.lang()).toBe('en');
    expect(i18n.t('nav.settings')).toBe('Settings');
  });

  it('uses Czech plural forms', () => {
    i18n.use('cs');
    const days = (n: number) => i18n.t('rules.daysAfterPlanting', { days: n });

    // Czech: 1 → "one", 2-4 → "few", everything else (also 21, 22) → "other".
    expect([days(1), days(3), days(5), days(21), days(22)]).toEqual([
      '1 den po výsadbě', '3 dny po výsadbě', '5 dní po výsadbě', '21 dní po výsadbě', '22 dní po výsadbě',
    ]);
    expect(i18n.t('settings.calendar.connectedStatus', { count: 0 })).toContain('je 0 nadcházejících úkolů');
  });

  it('switches back, and marks the page language', () => {
    i18n.use('cs');
    expect(document.documentElement.lang).toBe('cs');
    i18n.use('en');

    expect(i18n.t('rules.everyDays', { days: 1 })).toBe('every day');
    expect(i18n.t('rules.everyDays', { days: 3 })).toBe('every 3 days');
    expect(document.documentElement.lang).toBe('en');
  });

  it('joins several messages into one text', () => {
    expect(i18n.text([{ key: 'nav.tasks' }, { key: 'nav.garden' }])).toBe('Tasks Garden');
    expect(i18n.text(null)).toBeNull();
  });

  it('refuses keys that exist in neither language (a typo in the code)', () => {
    expect(() => i18n.t('nav.nope')).toThrowError(/Missing translation: nav.nope/);
  });
});

describe('browserLanguage', () => {
  it('picks Czech or English by the browser’s first preference among them', () => {
    expect(browserLanguage(['cs-CZ', 'en-US'])).toBe('cs');
    expect(browserLanguage(['en-GB', 'cs'])).toBe('en');
    expect(browserLanguage(['de-DE', 'cs'])).toBe('cs');
    expect(browserLanguage(['CS'])).toBe('cs');
  });

  it('falls back to English', () => {
    expect(browserLanguage(['de-DE', 'fr'])).toBe('en');
    expect(browserLanguage([])).toBe('en');
  });
});
