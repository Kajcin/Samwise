import { ChangeDetectionStrategy, Component, inject, input, model } from '@angular/core';
import { LanguageService } from '../core/i18n/language.service';
import {
  GROWTH_FORMS,
  GrowthForm,
  growthFormKey,
  hasLifeCycle,
  LIFE_CYCLES,
  LifeCycle,
  lifeCycleKey,
  PLANT_USES,
  PlantUse,
  toggled,
  useKey,
} from './traits';

/**
 * The life cycle, growth form and use fields, for the plant edit form and the
 * "add a plant" dialog:
 *   <app-plant-traits-fields idPrefix="plant" [(lifeCycle)]="…" [(growthForm)]="…" [(uses)]="…" />
 * Picking a shrub or a tree clears and disables the life cycle (see hasLifeCycle).
 */
@Component({
  selector: 'app-plant-traits-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row g-3">
      <div class="col-md-6">
        <label class="form-label" [for]="idPrefix() + '-life-cycle'">{{ i18n.t('traits.lifeCycle') }}</label>
        <select
          [id]="idPrefix() + '-life-cycle'"
          class="form-select"
          name="lifeCycle"
          [disabled]="!hasLifeCycle(growthForm())"
          (change)="lifeCycle.set($any($event.target).value || null)"
        >
          <option value="" [selected]="!lifeCycle()">{{ i18n.t('plant.notSet') }}</option>
          @for (value of lifeCycles; track value) {
            <option [value]="value" [selected]="lifeCycle() === value">{{ i18n.t(lifeCycleKey(value)) }}</option>
          }
        </select>
        @if (!hasLifeCycle(growthForm())) {
          <div class="form-text">{{ i18n.t('traits.noLifeCycle') }}</div>
        }
      </div>
      <div class="col-md-6">
        <label class="form-label" [for]="idPrefix() + '-growth-form'">{{ i18n.t('traits.growthForm') }}</label>
        <select
          [id]="idPrefix() + '-growth-form'"
          class="form-select"
          name="growthForm"
          (change)="setGrowthForm($any($event.target).value || null)"
        >
          <option value="" [selected]="!growthForm()">{{ i18n.t('plant.notSet') }}</option>
          @for (value of growthForms; track value) {
            <option [value]="value" [selected]="growthForm() === value">{{ i18n.t(growthFormKey(value)) }}</option>
          }
        </select>
      </div>
      <fieldset class="col-12">
        <legend class="form-label fs-6 mb-2">{{ i18n.t('traits.use') }}</legend>
        @for (value of plantUses; track value) {
          <div class="form-check form-check-inline">
            <input
              class="form-check-input"
              type="checkbox"
              name="uses"
              [id]="idPrefix() + '-use-' + value"
              [value]="value"
              [checked]="uses().includes(value)"
              (change)="uses.set(toggled(uses(), value))"
            />
            <label class="form-check-label" [for]="idPrefix() + '-use-' + value">{{ i18n.t(useKey(value)) }}</label>
          </div>
        }
      </fieldset>
    </div>
  `,
})
export class PlantTraitsFieldsComponent {
  protected i18n = inject(LanguageService);

  /** Keeps the fields' ids unique when the page has two of these. */
  idPrefix = input.required<string>();
  lifeCycle = model<LifeCycle | null>(null);
  growthForm = model<GrowthForm | null>(null);
  uses = model<PlantUse[]>([]);

  protected readonly lifeCycles = LIFE_CYCLES;
  protected readonly growthForms = GROWTH_FORMS;
  protected readonly plantUses = PLANT_USES;
  protected readonly lifeCycleKey = lifeCycleKey;
  protected readonly growthFormKey = growthFormKey;
  protected readonly useKey = useKey;
  protected readonly hasLifeCycle = hasLifeCycle;
  protected readonly toggled = toggled;

  setGrowthForm(form: GrowthForm | null): void {
    this.growthForm.set(form);
    if (!hasLifeCycle(form)) this.lifeCycle.set(null);
  }
}
