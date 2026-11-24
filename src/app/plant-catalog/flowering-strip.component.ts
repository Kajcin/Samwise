import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LanguageService } from '../core/i18n/language.service';
import { floweringIn } from './traits';

/**
 * The year as 12 cells, the flowering months highlighted:
 *   <app-flowering-strip [start]="5" [end]="9" />             small, for lists
 *   <app-flowering-strip [start]="5" [end]="9" size="lg" />   with the months' numbers (1.-12.), the same in every language
 * Screen readers get the range as one sentence.
 */
@Component({
  selector: 'app-flowering-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="strip" [class.strip-lg]="size() === 'lg'" role="img" [attr.aria-label]="label()" [title]="label()">
      @for (cell of cells(); track cell.month) {
        <span class="month" [class.on]="cell.on" aria-hidden="true">
          @if (size() === 'lg') {
            {{ cell.month }}.
          }
        </span>
      }
    </div>
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
    .month.on {
      background: #a83f84;
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
      background: #a83f84;
    }
  `,
})
export class FloweringStripComponent {
  protected i18n = inject(LanguageService);
  start = input<number | null | undefined>(null);
  end = input<number | null | undefined>(null);
  size = input<'sm' | 'lg'>('sm');

  protected cells = computed(() =>
    Array.from({ length: 12 }, (_, i) => ({ month: i + 1, on: floweringIn(i + 1, this.start() ?? null, this.end() ?? null) })),
  );

  protected label = computed(() => {
    const start = this.start();
    const end = this.end();
    if (start == null || end == null) return this.i18n.t('traits.floweringUnknown');
    return this.i18n.t('traits.floweringFromTo', {
      from: this.i18n.t(`dates.monthOf.${start}`),
      to: this.i18n.t(`dates.monthOf.${end}`),
    });
  });
}
