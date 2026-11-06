import { Injectable, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { InterpolatableTranslationObject, InterpolateFunction, InterpolationParameters, TranslateCompiler, TranslateService, TranslationObject } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

/** The languages of schuly.dev, each with the Swiss locale its dates and numbers use. */
export const LANGUAGES = [
  { code: 'de', label: 'Deutsch', locale: 'de-CH' },
  { code: 'en', label: 'English', locale: 'en-CH' },
  { code: 'fr', label: 'Français', locale: 'fr-CH' },
  { code: 'it', label: 'Italiano', locale: 'it-CH' },
  { code: 'rm', label: 'Rumantsch', locale: 'rm-CH' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];
export const DEFAULT_LANG: Lang = 'de';
export const LANGUAGE_KEY = 'schuly.language';

const isLang = (value: string | null | undefined): value is Lang => LANGUAGES.some((l) => l.code === value);

/** The saved choice, else the first supported browser language, else German. */
export function initialLanguage(saved: string | null, browser: readonly string[]): Lang {
  if (isLang(saved)) return saved;
  for (const tag of browser) {
    const code = tag.toLowerCase().split('-')[0];
    if (isLang(code)) return code;
  }
  return DEFAULT_LANG;
}

const current = signal<Lang>(DEFAULT_LANG);
type Params = Record<string, unknown>;
let lookup: (key: string, params?: Params) => string = (key) => key;

/** The active language; reading it inside a computed makes that computed rerun on a switch. */
export const currentLanguage = current.asReadonly();

/** The active locale (de-CH, fr-CH, ...) for Intl formatting. */
export const appLocale = (): string => LANGUAGES.find((l) => l.code === current())!.locale;

/** Translates outside templates (toasts, computeds, helpers); tracks the language like a signal. */
export function t(key: string, params?: Params): string {
  current();
  return lookup(key, params);
}

/** Swaps the translator behind t(); the app points it at ngx-translate, tests at a plain dictionary. */
export function useLookup(lang: Lang, next: (key: string, params?: Params) => string): void {
  lookup = next;
  current.set(lang);
}

const PLURAL = /\{(\w+), plural,((?:[^{}]|\{[^{}]*\})*)\}/g;
const CASE = /(=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g;
const VAR = /\{\{\s*(\w+)\s*\}\}/g;

/** Fills an ICU plural (`{count, plural, one {# grade} other {# grades}}`) and `{{name}}` params. */
export function format(text: string, params: Params = {}, locale: string = appLocale()): string {
  const rules = new Intl.PluralRules(locale);
  return text
    .replace(PLURAL, (_, name: string, body: string) => {
      const n = Number(params[name] ?? 0);
      const cases = new Map([...body.matchAll(CASE)].map((m) => [m[1], m[2]]));
      const picked = cases.get(`=${n}`) ?? cases.get(rules.select(n)) ?? cases.get('other') ?? '';
      return picked.replaceAll('#', new Intl.NumberFormat(locale).format(n));
    })
    .replace(VAR, (whole, name: string) => (params[name] === undefined ? whole : String(params[name])));
}

/** A dictionary lookup with the same formatting, for tests and the key-parity check. */
export function dictionaryLookup(json: object, locale = 'en-CH'): (key: string, params?: Params) => string {
  return (key, params) => {
    const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], json);
    return typeof value === 'string' ? format(value, params, locale) : key;
  };
}

const localeOf = (lang: string): string => LANGUAGES.find((l) => l.code === lang)?.locale ?? 'de-CH';

/** Lets ngx-translate understand ICU plurals: such strings become functions of their params. */
@Injectable()
export class PluralCompiler extends TranslateCompiler {
  compile(value: string, lang: string): string | InterpolateFunction {
    return value.includes(', plural,') ? (params?: InterpolationParameters) => format(value, params as Params, localeOf(lang)) : value;
  }

  compileTranslations(translations: TranslationObject, lang: string): InterpolatableTranslationObject {
    const walk = (node: unknown): unknown =>
      typeof node === 'string' ? this.compile(node, lang) : node && typeof node === 'object' ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)])) : node;
    return walk(translations) as InterpolatableTranslationObject;
  }
}

@Injectable({ providedIn: 'root' })
export class LanguageStore {
  private readonly translate = inject(TranslateService);
  readonly languages = LANGUAGES;
  readonly current = currentLanguage;

  /** Picks the start language and loads its strings; runs once as an app initializer. */
  init(): Promise<void> {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LANGUAGE_KEY);
    } catch {
      // Storage can be blocked; the browser language still works.
    }
    return this.apply(initialLanguage(saved, typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]));
  }

  /** Switches the language and remembers it on this device. */
  async use(code: Lang): Promise<void> {
    try {
      localStorage.setItem(LANGUAGE_KEY, code);
    } catch {
      // Not remembered, but the switch still applies.
    }
    await this.apply(code);
  }

  private async apply(code: Lang): Promise<void> {
    await firstValueFrom(this.translate.use(code));
    useLookup(code, (key, params) => this.translate.instant(key, params));
    document.documentElement.lang = code;
  }
}

/** Route titles are keys; the tab shows them translated. */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly translate = inject(TranslateService);
  private last: RouterStateSnapshot | null = null;

  constructor() {
    super();
    this.translate.onLangChange.subscribe(() => this.last && this.updateTitle(this.last));
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.last = snapshot;
    const key = this.buildTitle(snapshot);
    this.title.setTitle(key ? this.translate.instant(key) : 'Schuly');
  }
}
