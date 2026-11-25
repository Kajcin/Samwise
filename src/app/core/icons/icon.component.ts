import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ICONS, IconName, IconPath, LINE_ICONS } from './icons.generated';

/**
 * An icon as inline SVG: sized to the text (1em) and coloured like it. Bootstrap Icons
 * (filled, 16 × 16), or a line icon (24 × 24, stroked: scripts/icons/line).
 * Decorative by default (hidden from screen readers); pass `label` when the icon
 * carries meaning on its own, e.g. in a button without text.
 *
 *   <app-icon name="scissors" class="me-1" /> Prune
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (linePaths(); as lines) {
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="1em"
        height="1em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        focusable="false"
        [attr.aria-hidden]="label() ? null : 'true'"
        [attr.role]="label() ? 'img' : null"
        [attr.aria-label]="label()"
      >
        @for (d of lines; track $index) {
          <path [attr.d]="d" />
        }
      </svg>
    } @else {
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
    }
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

  protected paths = computed((): readonly IconPath[] => ICONS[this.name() as keyof typeof ICONS] ?? []);
  /** The paths of a line icon; null for a Bootstrap icon. */
  protected linePaths = computed((): readonly string[] | null => LINE_ICONS[this.name() as keyof typeof LINE_ICONS] ?? null);
}
