import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { Router, RouterLink } from '@angular/router';
import { Plant, PlantCatalogService, PlantInUseError } from './plant-catalog.service';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';
import { askToDeletePlant } from './delete-plant';
import { plantName, SUN_REQUIREMENTS, SunRequirement, sunKey } from './labels';
import { messageOf } from '../core/errors';
import { Lang, Message, msg } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';
import { FunctionError } from '../core/edge-functions';
import { isWebAddress } from '../core/web-address';
import { environment } from '../../environments/environment';
import { PlantCandidate, PlantLookupService } from './plant-lookup.service';
import { PlantPhoto, PlantPhotosService } from './plant-photos.service';

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
  imports: [RouterLink, IconComponent],
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

  private plants = signal<Plant[]>([]);
  loading = signal(true);
  error = signal<Message | null>(null);
  deletingId = signal<string | null>(null);
  /** Your main photo of each plant, by plant id; empty until loaded (or if that fails). */
  mainPhotos = signal<ReadonlyMap<string, PlantPhoto>>(new Map());
  /** Thumbnails whose picture didn't load: they show the placeholder. */
  brokenThumbs = signal<ReadonlySet<string>>(new Set());
  query = signal('');
  visiblePlants = computed(() => sortByName(filterPlants(this.plants(), this.query()), this.i18n.lang()));

  newPlantName = signal('');
  newPlantSun = signal<SunRequirement | null>(null);
  newPlantError = signal<Message | null>(null);
  // Filled in from a web lookup (and then editable); empty otherwise.
  newPlantSpecies = signal('');
  newPlantNotes = signal('');
  newPlantSourceUrl = signal('');
  /** The lookup result the form was pre-filled from. */
  prefilledFrom = signal<PlantCandidate | null>(null);
  private nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

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


  onSunChange(value: string): void {
    this.newPlantSun.set(value ? (value as SunRequirement) : null);
  }

  async cloneAndEdit(plantId: string): Promise<void> {
    this.error.set(null);
    try {
      const clone = await this.service.cloneToCustom(plantId, this.i18n.lang());
      this.plants.update((list) => [...list, clone]);
      await this.router.navigate(['/plants', clone.id]);
    } catch (e) {
      this.error.set(msg('catalog.errors.clone', { detail: messageOf(e) }));
    }
  }

  /** Your own plants only (built-in ones have no ✕); refused if the plant is or was planted. */
  async deletePlant(plant: Plant): Promise<void> {
    if (!(await askToDeletePlant(this.confirmDialog, this.i18n, plantName(plant, this.i18n.lang())))) return;
    this.error.set(null);
    this.deletingId.set(plant.id);
    try {
      await this.service.deletePlant(plant.id);
      this.plants.update((list) => list.filter((p) => p.id !== plant.id));
    } catch (e) {
      this.error.set(
        e instanceof PlantInUseError ? msg('plant.errors.inUse') : msg('plant.errors.delete', { detail: messageOf(e) }),
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

  /** Pre-fills the "Add a custom plant" form; the user checks it, picks the sun, and saves. */
  applyCandidate(candidate: PlantCandidate): void {
    this.newPlantName.set(candidate.name);
    this.newPlantSpecies.set(candidate.latinName);
    this.newPlantNotes.set(lookupNotes(candidate, this.i18n.t('lookup.attribution')));
    this.newPlantSourceUrl.set(candidate.url);
    this.newPlantError.set(null);
    this.prefilledFrom.set(candidate);
    const input = this.nameInput()?.nativeElement;
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus({ preventScroll: true });
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
    try {
      const plant = await this.service.addCustom({
        name: this.newPlantName().trim(),
        species: this.newPlantSpecies().trim() || null,
        sun_requirements: this.newPlantSun(),
        watering_frequency_days: null,
        flowering_start_month: null,
        flowering_end_month: null,
        notes: this.newPlantNotes().trim() || null,
        source_url: this.newPlantSourceUrl().trim() || null,
      });
      // From a lookup: the article's picture (with its credit) becomes the plant's photo.
      const image = this.prefilledFrom()?.image;
      if (image) {
        await this.photos.addWikimedia(plant.id, image).catch((e) => console.error('Could not add the photo:', messageOf(e)));
      }
      this.plants.update((list) => [...list, plant]);
      await this.router.navigate(['/plants', plant.id]);
    } catch (e) {
      this.newPlantError.set(msg('catalog.errors.save', { detail: messageOf(e) }));
    }
  }
}

