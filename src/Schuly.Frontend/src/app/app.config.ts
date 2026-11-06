import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { provideTranslateCompiler, provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideApi } from './api';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth';
import { DEFAULT_LANG, LanguageStore, PluralCompiler, TranslatedTitleStrategy } from './core/i18n';
import { AuthStore } from './stores/auth.store';
import { ThemeStore } from './stores/theme.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideApi(''),
    // German is the fallback for any key a language lacks. The JSON is fetched once per language and kept.
    provideTranslateService({
      fallbackLang: DEFAULT_LANG,
      loader: provideTranslateHttpLoader({ prefix: '/i18n/', suffix: '.json' }),
      compiler: provideTranslateCompiler(PluralCompiler),
    }),
    { provide: TitleStrategy, useExisting: TranslatedTitleStrategy },
    provideAppInitializer(() => {
      inject(ThemeStore);
      return Promise.all([inject(LanguageStore).init(), inject(AuthStore).restore()]).then(() => undefined);
    }),
  ],
};
