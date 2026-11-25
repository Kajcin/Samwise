import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { SpinnerComponent } from '../core/loading/spinner.component';
import { LoadingComponent } from '../core/loading/loading.component';
import { ModalComponent } from '../core/modal/modal.component';
import { PlantPhotosComponent } from './plant-photos.component';
import { PlantChipsComponent } from './plant-chips.component';
import { MonthStripComponent } from './month-strip.component';
import { PlantTraitsFieldsComponent } from './plant-traits-fields.component';
import { describeMonths, GrowthForm, hasLifeCycle, LifeCycle, PlantUse, Season, SUN_ICONS } from './traits';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  CareRule,
  MonthPart,
  Plant,
  PlantCatalogService,
  PlantChanges,
  PlantInGardenError,
  TaskType,
} from './plant-catalog.service';
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
import { isWebAddress } from '../core/web-address';
import { Message, msg } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';
import { decidePlantDeletion, inGardenMessage } from './delete-plant';
import { parseNumberInput } from '../core/number-input';

type TimingType = CareRule['timing_type'];

export function validateCareRuleForm(
  timingType: TimingType,
  offsetDays: number | null,
  recurrenceDays: number | null,
  month: number | null = null,
): Message | null {
  if (timingType === 'yearly') {
    if (month == null) return msg('plant.errors.monthRequired');
  } else if (timingType === 'offset_from_planting') {
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
  floweringMonths: number[];
  harvestMonths: number[];
  notes: string;
  sourceUrl: string;
  lifeCycle: LifeCycle | null;
  growthForm: GrowthForm | null;
  uses: PlantUse[];
}

export function plantToForm(plant: Plant): PlantForm {
  return {
    name: plant.name,
    species: plant.species ?? '',
    sun: plant.sun_requirements ?? '',
    wateringDays: plant.watering_frequency_days,
    floweringMonths: plant.flowering_months ?? [],
    harvestMonths: plant.harvest_months ?? [],
    notes: plant.notes ?? '',
    sourceUrl: plant.source_url ?? '',
    lifeCycle: plant.life_cycle ?? null,
    growthForm: plant.growth_form ?? null,
    uses: plant.uses ?? [],
  };
}

/** Mirrors the database's checks (migration 0010), with messages people understand. */
export function validatePlantForm(form: PlantForm): Message | null {
  if (!form.name.trim()) return msg('catalog.errors.nameRequired');
  if (!form.sun) return msg('catalog.errors.sunRequired');
  const days = form.wateringDays;
  if (days != null && (!Number.isInteger(days) || days < 1 || days > 365)) return msg('plant.errors.wateringInvalid');
  if (form.sourceUrl.trim() && !isWebAddress(form.sourceUrl.trim())) return msg('plant.errors.sourceUrlInvalid');
  return null;
}

export function formToChanges(form: PlantForm): PlantChanges {
  return {
    name: form.name.trim(),
    species: form.species.trim() || null,
    sun_requirements: form.sun || null,
    watering_frequency_days: form.wateringDays,
    flowering_months: form.floweringMonths,
    harvest_months: form.harvestMonths,
    notes: form.notes.trim() || null,
    source_url: form.sourceUrl.trim() || null,
    // Shrubs and trees have no life cycle (the database refuses one).
    life_cycle: hasLifeCycle(form.growthForm) ? form.lifeCycle : null,
    growth_form: form.growthForm,
    uses: form.uses,
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
const TIMING_ORDER: Record<TimingType, number> = { offset_from_planting: 0, recurring: 1, yearly: 2 };

/** Offset rules in timeline order, then recurring ones by interval, then yearly ones by month. */
function ruleOrder(a: CareRule, b: CareRule): number {
  if (a.timing_type !== b.timing_type) return TIMING_ORDER[a.timing_type] - TIMING_ORDER[b.timing_type];
  if (a.timing_type === 'offset_from_planting') return (a.offset_days ?? 0) - (b.offset_days ?? 0);
  if (a.timing_type === 'recurring') return (a.recurrence_days ?? 0) - (b.recurrence_days ?? 0);
  return (a.month ?? 0) - (b.month ?? 0);
}

@Component({
  selector: 'app-plant-detail',
  standalone: true,
  imports: [
    RouterLink,
    IconComponent,
    ModalComponent,
    PlantPhotosComponent,
    PlantChipsComponent,
    MonthStripComponent,
    PlantTraitsFieldsComponent, SpinnerComponent, LoadingComponent],
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
  protected readonly sunIcons = SUN_ICONS;

  /** "květen až září", "duben až červen, září až říjen". */
  protected describeMonths(months: readonly number[]): string {
    return describeMonths(months, (key, params) => this.i18n.t(key, params));
  }

  /** The edit form's draft; null when not editing. */
  draft = signal<PlantForm | null>(null);
  saving = signal(false);
  deleting = signal(false);
  cloning = signal(false);
  savingRule = signal(false);
  /** While the plant and its rules load. */
  loading = signal(true);
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
  newRuleMonth = signal<number | null>(null);
  /** null = the whole month. */
  newRuleMonthPart = signal<MonthPart | null>(null);
  /** Repeating rules: the months they keep to (none = all year), or a season of the plant. */
  newRuleMonths = signal<readonly number[]>([]);
  newRuleSeason = signal<Season | null>(null);
  /** The seasons a repeating rule can follow: those the plant has months for. */
  protected ruleSeasons = computed(() =>
    (['harvest', 'flowering'] as const).filter((season) => this.seasonMonths(season).length),
  );
  /** The "add a care rule" dialog. */
  ruleDialogOpen = signal(false);
  protected readonly monthParts: { id: string; value: MonthPart | null; label: string }[] = [
    { id: 'whole', value: null, label: 'plant.monthWhole' },
    { id: 'early', value: 'early', label: 'plant.monthEarly' },
    { id: 'late', value: 'late', label: 'plant.monthLate' },
  ];
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
    this.loading.set(true);
    try {
      const [plant, rules] = await Promise.all([this.catalog.get(this.plantId), this.catalog.listCareRules(this.plantId)]);
      this.plant.set(plant);
      this.rules.set(rules);
    } catch (e) {
      this.error.set(msg('plant.errors.load', { detail: messageOf(e) }));
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshCareRules(): Promise<void> {
    this.rules.set(await this.catalog.listCareRules(this.plantId));
  }

  async cloneAndEdit(): Promise<void> {
    this.error.set(null);
    this.cloning.set(true);
    try {
      const clone = await this.catalog.cloneToCustom(this.plantId, this.i18n.lang());
      await this.router.navigate(['/plants', clone.id]);
    } catch (e) {
      this.error.set(msg('plant.errors.clone', { detail: messageOf(e) }));
    } finally {
      this.cloning.set(false);
    }
  }

  openRuleDialog(): void {
    this.resetRuleForm();
    this.ruleDialogOpen.set(true);
  }

  /** Closes the dialog; what was typed is dropped. */
  closeRuleDialog(): void {
    this.ruleDialogOpen.set(false);
    this.resetRuleForm();
  }

  private resetRuleForm(): void {
    this.newRuleTaskType.set('seed_start');
    this.newRuleTimingType.set('offset_from_planting');
    this.newRuleOffsetDays.set(null);
    this.newRuleRecurrenceDays.set(null);
    this.newRuleMonth.set(null);
    this.newRuleMonthPart.set(null);
    this.newRuleMonths.set([]);
    this.newRuleSeason.set(null);
    this.newRuleError.set(null);
  }

  protected seasonMonths(season: Season): readonly number[] {
    const plant = this.plant();
    return (season === 'harvest' ? plant?.harvest_months : plant?.flowering_months) ?? [];
  }

  /** Follows the plant's season instead of months picked by hand, or stops following it. */
  toggleRuleSeason(season: Season): void {
    this.newRuleSeason.set(this.newRuleSeason() === season ? null : season);
    this.newRuleMonths.set([]);
  }

  async addCareRule(event: Event): Promise<void> {
    event.preventDefault();
    const timing = this.newRuleTimingType();
    const offset = timing === 'offset_from_planting' ? this.newRuleOffsetDays() : null;
    const recurrence = timing === 'recurring' ? this.newRuleRecurrenceDays() : null;
    const month = timing === 'yearly' ? this.newRuleMonth() : null;
    const validation = validateCareRuleForm(timing, offset, recurrence, month);
    this.newRuleError.set(validation);
    if (validation) return;
    this.savingRule.set(true);
    try {
      await this.catalog.addCareRule(this.plantId, {
        task_type: this.newRuleTaskType(),
        timing_type: timing,
        offset_days: offset,
        recurrence_days: recurrence,
        month,
        month_part: timing === 'yearly' ? this.newRuleMonthPart() : null,
        months: timing === 'recurring' && !this.newRuleSeason() ? [...this.newRuleMonths()] : [],
        season: timing === 'recurring' ? this.newRuleSeason() : null,
        notes: null,
      });
      this.closeRuleDialog();
      await this.refreshCareRules();
    } catch (e) {
      this.newRuleError.set(msg('plant.errors.saveRule', { detail: messageOf(e) }));
    } finally {
      this.savingRule.set(false);
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

  setDraftNumber(field: 'wateringDays', value: string): void {
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

  /** Not while the plant is in a bed: the page then says where. */
  async deletePlant(): Promise<void> {
    const plant = this.plant();
    if (!plant) return;
    this.deleting.set(true);
    this.error.set(null);
    try {
      const decision = await decidePlantDeletion(this.catalog, this.confirmDialog, this.i18n, this.plantId, plant.name);
      if (decision.kind === 'blocked') this.error.set(decision.message);
      if (decision.kind !== 'confirmed') return;
      await this.catalog.deletePlant(this.plantId);
      await this.router.navigate(['/plants']);
    } catch (e) {
      this.error.set(
        e instanceof PlantInGardenError ? inGardenMessage(e.beds) : msg('plant.errors.delete', { detail: messageOf(e) }),
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

  parseMonth(value: string): number | null {
    return parseNumberInput(value);
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
