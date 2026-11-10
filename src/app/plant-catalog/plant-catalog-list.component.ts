import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Plant, PlantCatalogService } from './plant-catalog.service';
import { SUN_LABELS } from './labels';
import { messageOf } from '../core/errors';

type SunRequirement = NonNullable<Plant['sun_requirements']>;

export function filterPlants(plants: Plant[], query: string): Plant[] {
  const q = query.trim().toLowerCase();
  if (!q) return plants;
  return plants.filter((p) => p.name.toLowerCase().includes(q));
}

export function validateNewPlantForm(name: string, sunRequirements: Plant['sun_requirements']): string | null {
  if (!name.trim()) return 'Name is required.';
  if (!sunRequirements) return 'Sun requirement is required.';
  return null;
}

function byName(a: Plant, b: Plant): number {
  return a.name.localeCompare(b.name);
}

@Component({
  selector: 'app-plant-catalog-list',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './plant-catalog-list.component.html',
})
export class PlantCatalogListComponent {
  private service = inject(PlantCatalogService);
  private router = inject(Router);

  protected readonly sunOptions = Object.entries(SUN_LABELS) as [SunRequirement, string][];

  private plants = signal<Plant[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  query = signal('');
  visiblePlants = computed(() => filterPlants(this.plants(), this.query()));

  newPlantName = signal('');
  newPlantSun = signal<SunRequirement | null>(null);
  newPlantError = signal<string | null>(null);

  constructor() {
    this.service
      .list()
      .then((p) => this.plants.set([...p].sort(byName)))
      .catch((e) => this.error.set(`Could not load plants: ${messageOf(e)}`))
      .finally(() => this.loading.set(false));
  }

  onSunChange(value: string): void {
    this.newPlantSun.set(value ? (value as SunRequirement) : null);
  }

  async cloneAndEdit(plantId: string): Promise<void> {
    this.error.set(null);
    try {
      const clone = await this.service.cloneToCustom(plantId);
      this.plants.update((list) => [...list, clone].sort(byName));
      await this.router.navigate(['/plants', clone.id]);
    } catch (e) {
      this.error.set(`Could not clone plant: ${messageOf(e)}`);
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
      this.plants.update((list) => [...list, plant].sort(byName));
      await this.router.navigate(['/plants', plant.id]);
    } catch (e) {
      this.newPlantError.set(`Could not save plant: ${messageOf(e)}`);
    }
  }
}

