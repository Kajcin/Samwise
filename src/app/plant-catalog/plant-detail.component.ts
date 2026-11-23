import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CareRule, Plant, PlantCatalogService, TaskType } from './plant-catalog.service';
import {
  describeRuleTiming,
  monthKey,
  plantName,
  plantNotes,
  ruleNotes,
  sunKey,
  TASK_TYPE_ICONS,
  TASK_TYPES,
  taskTypeKey,
} from './labels';
import { messageOf } from '../core/errors';
import { Message, msg } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';
import { parseNumberInput } from '../core/number-input';

type TimingType = CareRule['timing_type'];

export function validateCareRuleForm(
  timingType: TimingType,
  offsetDays: number | null,
  recurrenceDays: number | null,
): Message | null {
  if (timingType === 'offset_from_planting') {
    if (offsetDays == null) return msg('plant.errors.offsetRequired');
    if (!Number.isInteger(offsetDays) || offsetDays < 0) return msg('plant.errors.offsetInvalid');
  } else {
    if (recurrenceDays == null) return msg('plant.errors.recurrenceRequired');
    if (!Number.isInteger(recurrenceDays) || recurrenceDays < 1) return msg('plant.errors.recurrenceInvalid');
  }
  return null;
}

/** Offset rules in timeline order first, then recurring rules by interval. */
function ruleOrder(a: CareRule, b: CareRule): number {
  if (a.timing_type !== b.timing_type) return a.timing_type === 'offset_from_planting' ? -1 : 1;
  return a.timing_type === 'offset_from_planting'
    ? (a.offset_days ?? 0) - (b.offset_days ?? 0)
    : (a.recurrence_days ?? 0) - (b.recurrence_days ?? 0);
}

@Component({
  selector: 'app-plant-detail',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './plant-detail.component.html',
})
export class PlantDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private catalog = inject(PlantCatalogService);
  protected i18n = inject(LanguageService);

  protected readonly taskTypes = TASK_TYPES;
  protected readonly taskTypeKey = taskTypeKey;
  protected readonly taskIcons = TASK_TYPE_ICONS;
  protected readonly sunKey = sunKey;
  protected readonly monthKey = monthKey;
  protected readonly describeTiming = describeRuleTiming;
  protected readonly plantName = plantName;
  protected readonly plantNotes = plantNotes;
  protected readonly ruleNotes = ruleNotes;

  plant = signal<Plant | null>(null);
  /** Only the owner's custom plants are editable; built-in plants (user_id null) are read-only. */
  isEditable = computed(() => !!this.plant()?.user_id);
  private rules = signal<CareRule[]>([]);
  careRules = computed(() => [...this.rules()].sort(ruleOrder));
  error = signal<Message | null>(null);

  newRuleTaskType = signal<TaskType>('seed_start');
  newRuleTimingType = signal<TimingType>('offset_from_planting');
  newRuleOffsetDays = signal<number | null>(null);
  newRuleRecurrenceDays = signal<number | null>(null);
  newRuleError = signal<Message | null>(null);

  private plantId = '';

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((params) => {
      this.plantId = params.get('id') ?? '';
      this.load();
    });
  }

  private async load(): Promise<void> {
    this.error.set(null);
    this.plant.set(null);
    this.rules.set([]);
    try {
      const [plant, rules] = await Promise.all([this.catalog.get(this.plantId), this.catalog.listCareRules(this.plantId)]);
      this.plant.set(plant);
      this.rules.set(rules);
    } catch (e) {
      this.error.set(msg('plant.errors.load', { detail: messageOf(e) }));
    }
  }

  private async refreshCareRules(): Promise<void> {
    this.rules.set(await this.catalog.listCareRules(this.plantId));
  }

  async cloneAndEdit(): Promise<void> {
    this.error.set(null);
    try {
      const clone = await this.catalog.cloneToCustom(this.plantId, this.i18n.lang());
      await this.router.navigate(['/plants', clone.id]);
    } catch (e) {
      this.error.set(msg('plant.errors.clone', { detail: messageOf(e) }));
    }
  }

  async addCareRule(event: Event): Promise<void> {
    event.preventDefault();
    const timing = this.newRuleTimingType();
    const offset = timing === 'offset_from_planting' ? this.newRuleOffsetDays() : null;
    const recurrence = timing === 'recurring' ? this.newRuleRecurrenceDays() : null;
    const validation = validateCareRuleForm(timing, offset, recurrence);
    this.newRuleError.set(validation);
    if (validation) return;
    try {
      await this.catalog.addCareRule(this.plantId, {
        task_type: this.newRuleTaskType(),
        timing_type: timing,
        offset_days: offset,
        recurrence_days: recurrence,
        notes: null,
      });
      this.newRuleOffsetDays.set(null);
      this.newRuleRecurrenceDays.set(null);
      await this.refreshCareRules();
    } catch (e) {
      this.newRuleError.set(msg('plant.errors.saveRule', { detail: messageOf(e) }));
    }
  }

  async updateRuleNotes(ruleId: string, notes: string): Promise<void> {
    this.error.set(null);
    try {
      await this.catalog.updateCareRule(ruleId, { notes: notes.trim() || null });
      await this.refreshCareRules();
    } catch (e) {
      this.error.set(msg('plant.errors.saveNotes', { detail: messageOf(e) }));
    }
  }

  onTimingChange(value: string): void {
    this.newRuleTimingType.set(value as TimingType);
    this.newRuleError.set(null);
  }

  onTaskTypeChange(value: string): void {
    this.newRuleTaskType.set(value as TaskType);
  }

  onDaysInput(field: 'offset' | 'recurrence', value: string): void {
    (field === 'offset' ? this.newRuleOffsetDays : this.newRuleRecurrenceDays).set(parseNumberInput(value));
  }
}
