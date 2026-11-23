import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ICONS, IconName, IconPath } from './icons.generated';

/**
 * A Bootstrap Icon as inline SVG: sized to the text (1em) and coloured like it.
 * Decorative by default (hidden from screen readers); pass `label` when the icon
 * carries meaning on its own, e.g. in a button without text.
 *
 *   <app-icon name="scissors" class="me-1" /> Prune
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      fill="currentColor"
      focusable="false"
      [attr.aria-hidden]="label() ? null : 'true'"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label()"
    >
      @for (path of paths(); track $index) {
        <path [attr.d]="path.d" [attr.fill-rule]="path.fillRule ?? null" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: -0.125em;
    }
  `,
})
export class IconComponent {
  name = input.required<IconName>();
  /** Accessible name; omit for decorative icons next to text. */
  label = input<string | null>(null);

  protected paths = computed((): readonly IconPath[] => ICONS[this.name()]);
}
