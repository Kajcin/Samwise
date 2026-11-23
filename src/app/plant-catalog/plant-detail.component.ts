import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CareRule, Plant, PlantCatalogService, PlantChanges, PlantInUseError, TaskType } from './plant-catalog.service';
import {
  describeRuleTiming,
  monthKey,
  plantName,
  plantNotes,
  ruleNotes,
  SUN_REQUIREMENTS,
  SunRequirement,
  sunKey,
  TASK_TYPE_ICONS,
  TASK_TYPES,
  taskTypeKey,
} from './labels';
import { messageOf } from '../core/errors';
import { Message, msg } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';
import { askToDeletePlant } from './delete-plant';
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

/** The editable fields of your own plant, as the edit form holds them. */
export interface PlantForm {
  name: string;
  species: string;
  sun: SunRequirement | '';
  wateringDays: number | null;
  floweringStart: number | null;
  floweringEnd: number | null;
  notes: string;
  sourceUrl: string;
}

export function plantToForm(plant: Plant): PlantForm {
  return {
    name: plant.name,
    species: plant.species ?? '',
    sun: plant.sun_requirements ?? '',
    wateringDays: plant.watering_frequency_days,
    floweringStart: plant.flowering_start_month,
    floweringEnd: plant.flowering_end_month,
    notes: plant.notes ?? '',
    sourceUrl: plant.source_url ?? '',
  };
}

function isWebAddress(text: string): boolean {
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !/\s/.test(text);
  } catch {
    return false;
  }
}

/** Mirrors the database's checks (migration 0010), with messages people understand. */
export function validatePlantForm(form: PlantForm): Message | null {
  if (!form.name.trim()) return msg('catalog.errors.nameRequired');
  if (!form.sun) return msg('catalog.errors.sunRequired');
  const days = form.wateringDays;
  if (days != null && (!Number.isInteger(days) || days < 1 || days > 365)) return msg('plant.errors.wateringInvalid');
  if ((form.floweringStart == null) !== (form.floweringEnd == null)) return msg('plant.errors.floweringBoth');
  if (form.sourceUrl.trim() && !isWebAddress(form.sourceUrl.trim())) return msg('plant.errors.sourceUrlInvalid');
  return null;
}

export function formToChanges(form: PlantForm): PlantChanges {
  return {
    name: form.name.trim(),
    species: form.species.trim() || null,
    sun_requirements: form.sun || null,
    watering_frequency_days: form.wateringDays,
    flowering_start_month: form.floweringStart,
    flowering_end_month: form.floweringEnd,
    notes: form.notes.trim() || null,
    source_url: form.sourceUrl.trim() || null,
  };
}

/** "www.loukykvet.cz" for a link's text. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

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
  private confirmDialog = inject(ConfirmDialogService);

  protected readonly taskTypes = TASK_TYPES;
  protected readonly taskTypeKey = taskTypeKey;
  protected readonly taskIcons = TASK_TYPE_ICONS;
  protected readonly sunKey = sunKey;
  protected readonly monthKey = monthKey;
  protected readonly describeTiming = describeRuleTiming;
  protected readonly plantName = plantName;
  protected readonly plantNotes = plantNotes;
  protected readonly ruleNotes = ruleNotes;
  protected readonly sunOptions = SUN_REQUIREMENTS;
  protected readonly months = MONTHS;
  protected readonly linkHost = linkHost;

  /** The edit form's draft; null when not editing. */
  draft = signal<PlantForm | null>(null);
  saving = signal(false);
  deleting = signal(false);
  editError = signal<Message | null>(null);

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
    this.draft.set(null);
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

  startEditing(): void {
    const plant = this.plant();
    if (!plant || !this.isEditable()) return;
    this.draft.set(plantToForm(plant));
    this.editError.set(null);
  }

  cancelEditing(): void {
    this.draft.set(null);
    this.editError.set(null);
  }

  /** Updates one field of the draft (the form's inputs call this). */
  setDraft<K extends keyof PlantForm>(field: K, value: PlantForm[K]): void {
    this.draft.update((d) => (d ? { ...d, [field]: value } : d));
  }

  setDraftNumber(field: 'wateringDays' | 'floweringStart' | 'floweringEnd', value: string): void {
    this.setDraft(field, parseNumberInput(value));
  }

  async savePlant(event: Event): Promise<void> {
    event.preventDefault();
    const form = this.draft();
    if (!form) return;
    const validation = validatePlantForm(form);
    this.editError.set(validation);
    if (validation) return;
    this.saving.set(true);
    try {
      this.plant.set(await this.catalog.updatePlant(this.plantId, formToChanges(form)));
      this.draft.set(null);
    } catch (e) {
      this.editError.set(msg('plant.errors.save', { detail: messageOf(e) }));
    } finally {
      this.saving.set(false);
    }
  }

  async deletePlant(): Promise<void> {
    const plant = this.plant();
    if (!plant || !(await askToDeletePlant(this.confirmDialog, this.i18n, plant.name))) return;
    this.deleting.set(true);
    this.error.set(null);
    try {
      await this.catalog.deletePlant(this.plantId);
      await this.router.navigate(['/plants']);
    } catch (e) {
      this.error.set(
        e instanceof PlantInUseError ? msg('plant.errors.inUse') : msg('plant.errors.delete', { detail: messageOf(e) }),
      );
    } finally {
      this.deleting.set(false);
    }
  }

  async deleteCareRule(ruleId: string): Promise<void> {
    this.error.set(null);
    try {
      await this.catalog.deleteCareRule(ruleId);
      await this.refreshCareRules();
    } catch (e) {
      this.error.set(msg('plant.errors.deleteRule', { detail: messageOf(e) }));
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
