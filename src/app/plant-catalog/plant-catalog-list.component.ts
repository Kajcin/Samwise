import { Component, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { Router, RouterLink } from '@angular/router';
import { Plant, PlantCatalogService, PlantInUseError } from './plant-catalog.service';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';
import { askToDeletePlant } from './delete-plant';
import { plantName, SUN_REQUIREMENTS, SunRequirement, sunKey } from './labels';
import { messageOf } from '../core/errors';
import { Lang, Message, msg } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';

/** Matches the English and the Czech name, so "tomato" finds Rajče too. */
export function filterPlants(plants: Plant[], query: string): Plant[] {
  const q = query.trim().toLowerCase();
  if (!q) return plants;
  return plants.filter((p) => [p.name, p.name_cs].some((name) => name?.toLowerCase().includes(q)));
}

export function validateNewPlantForm(name: string, sunRequirements: Plant['sun_requirements']): Message | null {
  if (!name.trim()) return msg('catalog.errors.nameRequired');
  if (!sunRequirements) return msg('catalog.errors.sunRequired');
  return null;
}

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

  protected readonly sunOptions = SUN_REQUIREMENTS;
  protected readonly sunKey = sunKey;
  protected readonly plantName = plantName;

  private plants = signal<Plant[]>([]);
  loading = signal(true);
  error = signal<Message | null>(null);
  deletingId = signal<string | null>(null);
  query = signal('');
  visiblePlants = computed(() => sortByName(filterPlants(this.plants(), this.query()), this.i18n.lang()));

  newPlantName = signal('');
  newPlantSun = signal<SunRequirement | null>(null);
  newPlantError = signal<Message | null>(null);

  constructor() {
    this.service
      .list()
      .then((p) => this.plants.set(p))
      .catch((e) => this.error.set(msg('catalog.errors.load', { detail: messageOf(e) })))
      .finally(() => this.loading.set(false));
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

  async addCustomPlant(event: Event): Promise<void> {
    event.preventDefault();
    const validation = validateNewPlantForm(this.newPlantName(), this.newPlantSun());
    this.newPlantError.set(validation);
    if (validation) return;
    try {
      const plant = await this.service.addCustom({
        name: this.newPlantName().trim(),
        species: null,
        sun_requirements: this.newPlantSun(),
        watering_frequency_days: null,
        flowering_start_month: null,
        flowering_end_month: null,
        notes: null,
      });
      this.plants.update((list) => [...list, plant]);
      await this.router.navigate(['/plants', plant.id]);
    } catch (e) {
      this.newPlantError.set(msg('catalog.errors.save', { detail: messageOf(e) }));
    }
  }
}

