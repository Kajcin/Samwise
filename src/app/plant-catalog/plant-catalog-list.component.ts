import { Component, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { SpinnerComponent } from '../core/loading/spinner.component';
import { LoadingComponent } from '../core/loading/loading.component';
import { ModalComponent } from '../core/modal/modal.component';
import { Router, RouterLink } from '@angular/router';
import { Plant, PlantCatalogService, PlantInGardenError } from './plant-catalog.service';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';
import { decidePlantDeletion, inGardenMessage } from './delete-plant';
import { plantName, SUN_REQUIREMENTS, SunRequirement, sunKey } from './labels';
import { messageOf } from '../core/errors';
import { Lang, Message, msg } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';
import { FunctionError } from '../core/edge-functions';
import { isWebAddress } from '../core/web-address';
import { environment } from '../../environments/environment';
import { PlantCandidate, PlantLookupService } from './plant-lookup.service';
import { PlantPhoto, PlantPhotosService } from './plant-photos.service';
import { PlantChipsComponent } from './plant-chips.component';
import { MonthStripComponent } from './month-strip.component';
import { PlantTraitsFieldsComponent } from './plant-traits-fields.component';
import {
  activeFilterCount,
  catalogSeason,
  GROWTH_FORMS,
  GrowthForm,
  growthFormKey,
  hasLifeCycle,
  LIFE_CYCLES,
  LifeCycle,
  lifeCycleKey,
  matchesFilters,
  NO_FILTERS,
  PLANT_USES,
  PlantFilters,
  PlantUse,
  SUN_ICONS,
  toggled,
  useKey,
} from './traits';

type FilterGroup = keyof PlantFilters;

/** One filter button in the filter panel. */
interface FilterOption {
  value: string;
  labelKey: string;
  pressed: boolean;
  /** Its colours (the filter-pill classes in styles.scss). */
  cssClass: string;
  /** Life cycles show their chip colour as a dot before they're picked. */
  dot: boolean;
}

/** An active filter, shown as a removable chip. */
interface ActiveFilter {
  group: FilterGroup;
  value: string;
  labelKey: string;
  chipClass: string;
}

const FILTER_GROUPS: { key: FilterGroup; label: string; values: readonly string[]; labelKey: (value: never) => string }[] = [
  { key: 'lifeCycles', label: 'traits.lifeCycle', values: LIFE_CYCLES, labelKey: lifeCycleKey },
  { key: 'growthForms', label: 'traits.growthForm', values: GROWTH_FORMS, labelKey: growthFormKey },
  { key: 'uses', label: 'traits.use', values: PLANT_USES, labelKey: useKey },
];

function filterCssClass(group: FilterGroup, value: string): string {
  if (group === 'lifeCycles') return `pill-${value}`;
  return group === 'growthForms' ? 'pill-form' : 'pill-use';
}

function chipCssClass(group: FilterGroup, value: string): string {
  if (group === 'lifeCycles') return `chip-${value}`;
  return group === 'growthForms' ? 'chip-form' : 'chip-use';
}

/** Matches the English and the Czech name, so "tomato" finds Rajče too. */
export function filterPlants(plants: Plant[], query: string): Plant[] {
  const q = query.trim().toLowerCase();
  if (!q) return plants;
  return plants.filter((p) => [p.name, p.name_cs].some((name) => name?.toLowerCase().includes(q)));
}

export function validateNewPlantForm(
  name: string,
  sunRequirements: Plant['sun_requirements'],
  sourceUrl = '',
): Message | null {
  if (!name.trim()) return msg('catalog.errors.nameRequired');
  if (!sunRequirements) return msg('catalog.errors.sunRequired');
  if (sourceUrl.trim() && !isWebAddress(sourceUrl.trim())) return msg('plant.errors.sourceUrlInvalid');
  return null;
}

/** The notes for a plant pre-filled from Wikipedia: its intro, credited (CC BY-SA). */
export function lookupNotes(candidate: PlantCandidate, attribution: string): string {
  return `${candidate.description} ${attribution}`.trim();
}

/** Searches shorter than this aren't offered for a web lookup. */
export const MIN_LOOKUP_LENGTH = 2;

/** Sorted by the name shown in `lang`. */
export function sortByName(plants: Plant[], lang: Lang): Plant[] {
  return [...plants].sort((a, b) => plantName(a, lang).localeCompare(plantName(b, lang), lang));
}

@Component({
  selector: 'app-plant-catalog-list',
  standalone: true,
  imports: [RouterLink, IconComponent, ModalComponent, PlantChipsComponent, MonthStripComponent, PlantTraitsFieldsComponent, SpinnerComponent, LoadingComponent],
  templateUrl: './plant-catalog-list.component.html',
  styles: `
    .lookup-thumb {
      width: 4.5rem;
      height: 4.5rem;
      object-fit: cover;
      border-radius: 0.4rem;
    }
    .catalog-thumb {
      width: 2.75rem;
      height: 2.75rem;
      flex-shrink: 0;
      border-radius: 0.4rem;
      overflow: hidden;
      background: linear-gradient(160deg, #f4f7ec, #e2ecd2);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--bs-primary);
      opacity: 0.9;
    }
    .catalog-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .plant-main {
      flex: 1 1 16rem;
      min-width: 0;
    }
    .fact-sun {
      display: inline-flex;
      width: 1.25rem;
      font-size: 1.15rem;
    }
    .fact-water {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      width: 3.25rem;
    }
    /* Same width on every row (md and up), so the facts before it line up. */
    @media (min-width: 768px) {
      .plant-actions {
        min-width: 15.5rem;
        justify-content: flex-end;
      }
    }
    .delete-slot {
      display: inline-flex;
      justify-content: center;
      width: 1.5rem;
      flex-shrink: 0;
      font-size: 1.15rem;
    }
  `,
})
export class PlantCatalogListComponent {
  private service = inject(PlantCatalogService);
  private router = inject(Router);
  protected i18n = inject(LanguageService);
  private confirmDialog = inject(ConfirmDialogService);
  private lookupService = inject(PlantLookupService);
  private photos = inject(PlantPhotosService);

  protected readonly sunOptions = SUN_REQUIREMENTS;
  protected readonly sunKey = sunKey;
  protected readonly plantName = plantName;
  protected readonly sunIcons = SUN_ICONS;
  /** One season per row: the harvest of edible plants, otherwise flowering. */
  protected readonly catalogSeason = catalogSeason;

  private plants = signal<Plant[]>([]);
  loading = signal(true);
  error = signal<Message | null>(null);
  deletingId = signal<string | null>(null);
  cloningId = signal<string | null>(null);
  savingPlant = signal(false);
  /** Your main photo of each plant, by plant id; empty until loaded (or if that fails). */
  mainPhotos = signal<ReadonlyMap<string, PlantPhoto>>(new Map());
  /** Thumbnails whose picture didn't load: they show the placeholder. */
  brokenThumbs = signal<ReadonlySet<string>>(new Set());
  query = signal('');
  /** The catalog's filters, and whether their panel is open. */
  filters = signal<PlantFilters>(NO_FILTERS);
  filtersOpen = signal(false);
  activeFilterCount = computed(() => activeFilterCount(this.filters()));
  visiblePlants = computed(() =>
    sortByName(
      filterPlants(this.plants(), this.query()).filter((p) => matchesFilters(p, this.filters())),
      this.i18n.lang(),
    ),
  );
  totalCount = computed(() => this.plants().length);

  filterGroups = computed(() => {
    const filters = this.filters();
    return FILTER_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      options: group.values.map(
        (value): FilterOption => ({
          value,
          labelKey: group.labelKey(value as never),
          pressed: (filters[group.key] as readonly string[]).includes(value),
          cssClass: filterCssClass(group.key, value),
          dot: group.key === 'lifeCycles',
        }),
      ),
    }));
  });

  /** In the panel's order, so the chips don't jump around as filters are picked. */
  activeFilters = computed(() =>
    this.filterGroups().flatMap((group) =>
      group.options
        .filter((option) => option.pressed)
        .map(
          (option): ActiveFilter => ({
            group: group.key,
            value: option.value,
            labelKey: option.labelKey,
            chipClass: chipCssClass(group.key, option.value),
          }),
        ),
    ),
  );

  newPlantName = signal('');
  newPlantSun = signal<SunRequirement | null>(null);
  newPlantError = signal<Message | null>(null);
  // Filled in from a web lookup (and then editable); empty otherwise.
  newPlantSpecies = signal('');
  newPlantNotes = signal('');
  newPlantSourceUrl = signal('');
  newPlantLifeCycle = signal<LifeCycle | null>(null);
  newPlantGrowthForm = signal<GrowthForm | null>(null);
  newPlantUses = signal<PlantUse[]>([]);
  /** The lookup result the form was pre-filled from. */
  prefilledFrom = signal<PlantCandidate | null>(null);
  /** The "add a custom plant" dialog. */
  addDialogOpen = signal(false);

  /** The web lookup: the search it ran, its results (null until run), its state. */
  canLookUp = computed(() => this.query().trim().length >= MIN_LOOKUP_LENGTH);
  lookupQuery = signal('');
  lookupResults = signal<PlantCandidate[] | null>(null);
  lookupLoading = signal(false);
  lookupError = signal<Message[] | null>(null);

  constructor() {
    this.loadMainPhotos();
    this.service
      .list()
      .then((p) => this.plants.set(p))
      .catch((e) => this.error.set(msg('catalog.errors.load', { detail: messageOf(e) })))
      .finally(() => this.loading.set(false));
  }
  /** The catalog works without thumbnails, so a failure here is only logged. */
  private async loadMainPhotos(): Promise<void> {
    try {
      this.mainPhotos.set(await this.photos.mainPhotos());
    } catch (e) {
      console.error('Could not load the plant photos:', messageOf(e));
    }
  }

  markThumbBroken(plantId: string): void {
    this.brokenThumbs.update((set) => new Set(set).add(plantId));
  }


  toggleFilter(group: FilterGroup, value: string): void {
    this.filters.update((filters) => ({ ...filters, [group]: toggled(filters[group] as readonly string[], value) }));
  }

  clearFilters(): void {
    this.filters.set(NO_FILTERS);
  }

  onSunChange(value: string): void {
    this.newPlantSun.set(value ? (value as SunRequirement) : null);
  }

  async cloneAndEdit(plantId: string): Promise<void> {
    this.error.set(null);
    this.cloningId.set(plantId);
    try {
      const clone = await this.service.cloneToCustom(plantId, this.i18n.lang());
      this.plants.update((list) => [...list, clone]);
      await this.router.navigate(['/plants', clone.id]);
    } catch (e) {
      this.error.set(msg('catalog.errors.clone', { detail: messageOf(e) }));
    } finally {
      this.cloningId.set(null);
    }
  }

  /** Your own plants only (built-in ones have no ✕); not while the plant is in a bed. */
  async deletePlant(plant: Plant): Promise<void> {
    this.error.set(null);
    this.deletingId.set(plant.id);
    try {
      const name = plantName(plant, this.i18n.lang());
      const decision = await decidePlantDeletion(this.service, this.confirmDialog, this.i18n, plant.id, name);
      if (decision.kind === 'blocked') this.error.set(decision.message);
      if (decision.kind !== 'confirmed') return;
      await this.service.deletePlant(plant.id);
      this.plants.update((list) => list.filter((p) => p.id !== plant.id));
    } catch (e) {
      this.error.set(
        e instanceof PlantInGardenError ? inGardenMessage(e.beds) : msg('plant.errors.delete', { detail: messageOf(e) }),
      );
    } finally {
      this.deletingId.set(null);
    }
  }

  /** Looks the current search up on Wikipedia (via the plant-lookup Edge Function). */
  async searchWeb(): Promise<void> {
    const query = this.query().trim();
    if (query.length < MIN_LOOKUP_LENGTH) return;
    this.lookupQuery.set(query);
    this.lookupResults.set(null);
    this.lookupError.set(null);
    this.lookupLoading.set(true);
    try {
      this.lookupResults.set(await this.lookupService.lookup(query, this.i18n.lang()));
    } catch (e) {
      const unreachable = e instanceof FunctionError && e.code === 'unreachable';
      this.lookupError.set(
        unreachable
          ? [msg('lookup.errors.unreachable'), ...(environment.production ? [] : [msg('settings.calendar.errors.devHint')])]
          : [msg('lookup.errors.failed')],
      );
    } finally {
      this.lookupLoading.set(false);
    }
  }

  closeLookup(): void {
    this.lookupResults.set(null);
    this.lookupError.set(null);
  }

  /** Opens the "Add a custom plant" dialog empty. */
  openAddDialog(): void {
    this.resetAddForm();
    this.addDialogOpen.set(true);
  }

  /** Closes the dialog; what was typed (or pre-filled) is dropped. */
  closeAddDialog(): void {
    this.addDialogOpen.set(false);
    this.resetAddForm();
  }

  private resetAddForm(): void {
    this.newPlantName.set('');
    this.newPlantSun.set(null);
    this.newPlantLifeCycle.set(null);
    this.newPlantGrowthForm.set(null);
    this.newPlantUses.set([]);
    this.newPlantError.set(null);
    this.clearPrefill();
  }

  /** Opens the dialog pre-filled from a lookup result; the user checks it, picks the sun, and saves. */
  applyCandidate(candidate: PlantCandidate): void {
    this.resetAddForm();
    this.newPlantName.set(candidate.name);
    this.newPlantSpecies.set(candidate.latinName);
    this.newPlantNotes.set(lookupNotes(candidate, this.i18n.t('lookup.attribution')));
    this.newPlantSourceUrl.set(candidate.url);
    this.prefilledFrom.set(candidate);
    this.addDialogOpen.set(true);
  }

  clearPrefill(): void {
    this.newPlantSpecies.set('');
    this.newPlantNotes.set('');
    this.newPlantSourceUrl.set('');
    this.prefilledFrom.set(null);
  }

  async addCustomPlant(event: Event): Promise<void> {
    event.preventDefault();
    const validation = validateNewPlantForm(this.newPlantName(), this.newPlantSun(), this.newPlantSourceUrl());
    this.newPlantError.set(validation);
    if (validation) return;
    this.savingPlant.set(true);
    try {
      const plant = await this.service.addCustom({
        name: this.newPlantName().trim(),
        species: this.newPlantSpecies().trim() || null,
        sun_requirements: this.newPlantSun(),
        watering_frequency_days: null,
        notes: this.newPlantNotes().trim() || null,
        source_url: this.newPlantSourceUrl().trim() || null,
        life_cycle: hasLifeCycle(this.newPlantGrowthForm()) ? this.newPlantLifeCycle() : null,
        growth_form: this.newPlantGrowthForm(),
        uses: this.newPlantUses(),
      });
      // From a lookup: the article's picture (with its credit) becomes the plant's photo.
      const image = this.prefilledFrom()?.image;
      if (image) {
        await this.photos.addWikimedia(plant.id, image).catch((e) => console.error('Could not add the photo:', messageOf(e)));
      }
      this.plants.update((list) => [...list, plant]);
      this.addDialogOpen.set(false);
      await this.router.navigate(['/plants', plant.id]);
    } catch (e) {
      this.newPlantError.set(msg('catalog.errors.save', { detail: messageOf(e) }));
    } finally {
      this.savingPlant.set(false);
    }
  }
}

