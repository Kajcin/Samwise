import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A spinner with a line of text, for waiting on something that takes a while: a page
 * loading its data, a search on the web, connecting the calendar.
 *
 *   @if (loading()) { <app-loading [text]="i18n.t('catalog.loading')" /> }
 *   <app-loading size="lg" [text]="…" />   large and centered, holding the place of
 *                                          results that are on their way
 *
 * Screen readers hear the text (role=status).
 */
@Component({
  selector: 'app-loading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    class: 'd-flex align-items-center text-body-secondary',
    '[class.gap-2]': "size() === 'sm'",
    '[class.flex-column]': "size() === 'lg'",
    '[class.justify-content-center]': "size() === 'lg'",
    '[class.text-center]': "size() === 'lg'",
    '[class.gap-3]': "size() === 'lg'",
    '[class.py-5]': "size() === 'lg'",
  },
  template: `
    <span
      class="spinner-border text-primary flex-shrink-0"
      [class.spinner-border-sm]="size() === 'sm'"
      [class.spinner-lg]="size() === 'lg'"
      aria-hidden="true"
    ></span>
    <span class="loading-text">{{ text() }}</span>
  `,
  styles: `
    .spinner-lg {
      --bs-spinner-width: 3rem;
      --bs-spinner-height: 3rem;
      --bs-spinner-border-width: 0.3rem;
    }
  `,
})
export class LoadingComponent {
  text = input.required<string>();
  size = input<'sm' | 'lg'>('sm');
}
