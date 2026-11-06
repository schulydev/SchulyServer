import { TestBed } from '@angular/core/testing';
import { TranslateLoader, provideTranslateCompiler, provideTranslateLoader, provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import en from '../public/i18n/en.json';
import { PluralCompiler, dictionaryLookup, useLookup } from './app/core/i18n';

// Specs read English: t() looks keys up in en.json, and components get a TranslateService that serves it.
useLookup('en', dictionaryLookup(en));

class EnglishLoader implements TranslateLoader {
  getTranslation() {
    return of(en);
  }
}

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideTranslateService({ lang: 'en', fallbackLang: 'en', loader: provideTranslateLoader(EnglishLoader), compiler: provideTranslateCompiler(PluralCompiler) })],
  });
});
