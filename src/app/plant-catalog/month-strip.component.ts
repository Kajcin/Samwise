import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { LanguageService } from '../core/i18n/language.service';
import { describeMonths, Season, toggled } from './traits';

/**
 * The year as 12 cells, the season's months highlighted (flowering purple, harvest orange):
 *   <app-month-strip kind="harvest" [months]="[4, 5, 9]" />              small, for lists
 *   <app-month-strip kind="harvest" [months]="…" size="lg" />            numbered 1.-12.
 *   <app-month-strip kind="harvest" [(months)]="…" size="lg" editable />  click to pick
 *   <app-month-strip kind="rule" [(months)]="…" [label]="…" editable />  a care rule's months
 * The months are numbered so the strip reads the same in every language. Screen readers
 * get the season as one sentence, or (editable) a toggle button per month.
 */
@Component({
  selector: 'app-month-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editable()) {
      <div class="strip strip-lg {{ kind() }}" role="group" [attr.aria-label]="groupLabel()">
        @for (cell of cells(); track cell.month) {
          <button
            type="button"
            class="month"
            [class.on]="cell.on"
            [attr.aria-pressed]="cell.on"
            [attr.aria-label]="i18n.t('months.' + cell.month)"
            [title]="i18n.t('months.' + cell.month)"
            (click)="toggle(cell.month)"
          >
            {{ cell.month }}.
          </button>
        }
      </div>
    } @else {
      <div class="strip {{ kind() }}" [class.strip-lg]="size() === 'lg'" role="img" [attr.aria-label]="summary()" [title]="summary()">
        @for (cell of cells(); track cell.month) {
          <span class="month" [class.on]="cell.on" aria-hidden="true">
            @if (size() === 'lg') {
              {{ cell.month }}.
            }
          </span>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: inline-block;
    }
    .strip {
      display: flex;
      gap: 2px;
    }
    .month {
      width: 7px;
      height: 12px;
      border-radius: 2px;
      background: #e3e7de;
    }
    .flowering .month.on {
      background: #a83f84;
    }
    .harvest .month.on {
      background: #a64f0f;
    }
    .rule .month.on {
      background: var(--bs-primary);
    }
    .strip-lg {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 3px;
      max-width: 26rem;
    }
    .strip-lg .month {
      width: auto;
      height: 1.9rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
      color: #5f675a;
      background: #eef0eb;
    }
    .strip-lg .month.on {
      color: #fff;
    }
    button.month {
      height: 2.25rem;
      padding: 0;
      border: 1px solid #d5dacf;
    }
    button.month:hover {
      border-color: var(--bs-primary);
    }
    button.month.on {
      border-color: transparent;
    }
    button.month:focus-visible {
      outline: 0;
      box-shadow: 0 0 0 0.25rem rgba(59, 110, 34, 0.25);
    }
  `,
})
export class MonthStripComponent {
  protected i18n = inject(LanguageService);
  months = model<readonly number[]>([]);
  /** A plant's season, or (rule) the months a care rule keeps to. */
  kind = input<Season | 'rule'>('flowering');
  /** What the months are, for screen readers; by default the season's name. */
  label = input<string>();
  size = input<'sm' | 'lg'>('sm');
  editable = input(false, { transform: booleanAttribute });

  protected cells = computed(() => {
    const months = this.months();
    return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, on: months.includes(i + 1) }));
  });

  protected groupLabel = computed(
    () => this.label() ?? this.i18n.t(this.kind() === 'harvest' ? 'plant.harvest' : 'plant.flowering'),
  );

  protected summary = computed(() => {
    if (this.kind() === 'rule') {
      return `${this.groupLabel()}: ${describeMonths(this.months(), (key, params) => this.i18n.t(key, params))}`;
    }
    const harvest = this.kind() === 'harvest';
    if (!this.months().length) return this.i18n.t(harvest ? 'traits.harvestUnknown' : 'traits.floweringUnknown');
    return this.i18n.t(harvest ? 'traits.harvestMonths' : 'traits.floweringMonths', {
      months: describeMonths(this.months(), (key, params) => this.i18n.t(key, params)),
    });
  });

  /** Picks or unpicks a month; the months stay in calendar order. */
  protected toggle(month: number): void {
    this.months.set([...toggled(this.months(), month)].sort((a, b) => a - b));
  }
}
