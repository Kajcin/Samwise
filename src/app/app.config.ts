import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideI18n } from './core/i18n/i18n';
import { UserLanguageService } from './core/i18n/user-language.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideI18n(),
    // Picks the language (browser's, then the signed-in user's) before the first render.
    provideAppInitializer(() => {
      inject(UserLanguageService);
    }),
  ],
};
