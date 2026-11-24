import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A small spinning ring, in the colour of the text around it, for a button whose action
 * is running. It stands in for the button's icon:
 *
 *   <button [disabled]="saving()" [attr.aria-busy]="saving()">
 *     @if (saving()) { <app-spinner class="me-1" /> } @else { <app-icon name="check-lg" class="me-1" /> }
 *     Save
 *   </button>
 *
 * Decorative: the button's aria-busy (or a status text nearby) tells screen readers.
 */
@Component({
  selector: 'app-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'd-inline-flex align-middle' },
  template: `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>`,
  styles: `
    .spinner-border-sm {
      --bs-spinner-width: 1em;
      --bs-spinner-height: 1em;
      --bs-spinner-border-width: 0.15em;
    }
  `,
})
export class SpinnerComponent {}
