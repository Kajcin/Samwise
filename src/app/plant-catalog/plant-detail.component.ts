import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CareRule, Plant, PlantCatalogService, TaskType } from './plant-catalog.service';
import { describeRuleTiming, monthName, SUN_LABELS, TASK_TYPE_LABELS, TASK_TYPES } from './labels';
import { messageOf } from '../core/errors';
import { parseNumberInput } from '../core/number-input';

type TimingType = CareRule['timing_type'];

export function validateCareRuleForm(
  timingType: TimingType,
  offsetDays: number | null,
  recurrenceDays: number | null,
): string | null {
  if (timingType === 'offset_from_planting') {
    if (offsetDays == null) return 'Offset days is required for an offset rule.';
    if (!Number.isInteger(offsetDays) || offsetDays < 0) return 'Offset days must be a whole number of 0 or more.';
  } else {
    if (recurrenceDays == null) return 'Recurrence days is required for a recurring rule.';
    if (!Number.isInteger(recurrenceDays) || recurrenceDays < 1) return 'Recurrence days must be a whole number of 1 or more.';
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
  imports: [RouterLink],
  templateUrl: './plant-detail.component.html',
})
export class PlantDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private catalog = inject(PlantCatalogService);

  protected readonly taskTypes = TASK_TYPES;
  protected readonly taskLabels = TASK_TYPE_LABELS;
  protected readonly sunLabels = SUN_LABELS;
  protected readonly monthName = monthName;
  protected readonly describeTiming = describeRuleTiming;

  plant = signal<Plant | null>(null);
  /** Only the owner's custom plants are editable; built-in plants (user_id null) are read-only. */
  isEditable = computed(() => !!this.plant()?.user_id);
  private rules = signal<CareRule[]>([]);
  careRules = computed(() => [...this.rules()].sort(ruleOrder));
  error = signal<string | null>(null);

  newRuleTaskType = signal<TaskType>('seed_start');
  newRuleTimingType = signal<TimingType>('offset_from_planting');
  newRuleOffsetDays = signal<number | null>(null);
  newRuleRecurrenceDays = signal<number | null>(null);
  newRuleError = signal<string | null>(null);

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
      this.error.set(`Could not load plant: ${messageOf(e)}`);
    }
  }

  private async refreshCareRules(): Promise<void> {
    this.rules.set(await this.catalog.listCareRules(this.plantId));
  }

  async cloneAndEdit(): Promise<void> {
    this.error.set(null);
    try {
      const clone = await this.catalog.cloneToCustom(this.plantId);
      await this.router.navigate(['/plants', clone.id]);
    } catch (e) {
      this.error.set(`Could not clone plant: ${messageOf(e)}`);
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
      this.newRuleError.set(`Could not save rule: ${messageOf(e)}`);
    }
  }

  async updateRuleNotes(ruleId: string, notes: string): Promise<void> {
    this.error.set(null);
    try {
      await this.catalog.updateCareRule(ruleId, { notes: notes.trim() || null });
      await this.refreshCareRules();
    } catch (e) {
      this.error.set(`Could not save notes: ${messageOf(e)}`);
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
