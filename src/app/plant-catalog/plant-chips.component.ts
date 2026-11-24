import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LanguageService } from '../core/i18n/language.service';
import type { Plant } from './plant-catalog.service';
import { growthFormKey, lifeCycleKey, PLANT_USES, showsGrowthFormChip, useKey } from './traits';

/**
 * A plant's life cycle, growth form and uses as chips:
 *   <app-plant-chips [plant]="plant" />
 * Shows nothing for what isn't set.
 */
@Component({
  selector: 'app-plant-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'd-inline-flex flex-wrap gap-1 align-items-center' },
  template: `
    @if (plant().life_cycle; as cycle) {
      <span class="plant-chip chip-{{ cycle }} life-cycle-chip">{{ i18n.t(lifeCycleKey(cycle)) }}</span>
    }
    @if (growthForm(); as form) {
      <span class="plant-chip chip-form growth-form-chip">{{ i18n.t(growthFormKey(form)) }}</span>
    }
    @for (use of uses(); track use) {
      <span class="plant-chip chip-use use-chip">{{ i18n.t(useKey(use)) }}</span>
    }
  `,
})
export class PlantChipsComponent {
  protected i18n = inject(LanguageService);
  plant = input.required<Pick<Plant, 'life_cycle' | 'growth_form' | 'uses'>>();

  protected readonly lifeCycleKey = lifeCycleKey;
  protected readonly growthFormKey = growthFormKey;
  protected readonly useKey = useKey;

  protected growthForm = computed(() => {
    const form = this.plant().growth_form;
    return showsGrowthFormChip(form) ? form : null;
  });
  /** Always in the same order, whatever order they were picked in. */
  protected uses = computed(() => PLANT_USES.filter((use) => this.plant().uses?.includes(use)));
}
