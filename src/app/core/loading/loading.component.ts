import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A spinner with a line of text, for waiting on something that takes a while: a page
 * loading its data, a search on the web, connecting the calendar.
 *
 *   @if (loading()) { <app-loading [text]="i18n.t('catalog.loading')" /> }
 *
 * Screen readers hear the text (role=status).
 */
@Component({
  selector: 'app-loading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'd-flex align-items-center gap-2 text-body-secondary', role: 'status' },
  template: `
    <span class="spinner-border spinner-border-sm text-primary flex-shrink-0" aria-hidden="true"></span>
    <span class="loading-text">{{ text() }}</span>
  `,
})
export class LoadingComponent {
  text = input.required<string>();
}
