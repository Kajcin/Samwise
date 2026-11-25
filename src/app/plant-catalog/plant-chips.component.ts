import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { LanguageService } from '../core/i18n/language.service';
import type { Plant } from './plant-catalog.service';
import { GROWTH_FORM_ICONS, growthFormKey, lifeCycleKey, PLANT_USES, showsGrowthFormChip, USE_ICONS, useKey } from './traits';

/**
 * A plant's life cycle, growth form and uses as chips:
 *   <app-plant-chips [plant]="plant" />           words, growth form and uses with an icon
 *   <app-plant-chips [plant]="plant" compact />   growth form and uses as icons only, named
 *                                                 in a tooltip and for screen readers (the catalog)
 * The life cycle is always a word, in its colour. Shows nothing for what isn't set.
 */
@Component({
  selector: 'app-plant-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'd-inline-flex flex-wrap gap-1 align-items-center' },
  imports: [IconComponent],
  template: `
    @if (plant().life_cycle; as cycle) {
      <span class="plant-chip chip-{{ cycle }} life-cycle-chip">{{ i18n.t(lifeCycleKey(cycle)) }}</span>
    }
    @if (growthForm(); as form) {
      @if (compact()) {
        <span class="plant-chip chip-form growth-form-chip icon-only" [title]="i18n.t(growthFormKey(form))">
          <app-icon [name]="growthFormIcons[form]" [label]="i18n.t(growthFormKey(form))" />
        </span>
      } @else {
        <span class="plant-chip chip-form growth-form-chip">
          <app-icon [name]="growthFormIcons[form]" />{{ i18n.t(growthFormKey(form)) }}
        </span>
      }
    }
    @for (use of uses(); track use) {
      @if (compact()) {
        <span class="plant-chip chip-use use-chip icon-only" [title]="i18n.t(useKey(use))">
          <app-icon [name]="useIcons[use]" [label]="i18n.t(useKey(use))" />
        </span>
      } @else {
        <span class="plant-chip chip-use use-chip"><app-icon [name]="useIcons[use]" />{{ i18n.t(useKey(use)) }}</span>
      }
    }
  `,
})
export class PlantChipsComponent {
  protected i18n = inject(LanguageService);
  plant = input.required<Pick<Plant, 'life_cycle' | 'growth_form' | 'uses'>>();
  /** Icons only (named in a tooltip): for lists. */
  compact = input(false, { transform: booleanAttribute });
  protected readonly growthFormIcons = GROWTH_FORM_ICONS;
  protected readonly useIcons = USE_ICONS;

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
