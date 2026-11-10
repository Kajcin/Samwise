import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Bed, cellKey, GardenService, Planting } from './garden.service';
import { Plant, PlantCatalogService } from '../plant-catalog/plant-catalog.service';
import { messageOf } from '../core/errors';
import { toIsoDate } from '../core/dates';

type Grid = (Planting | null)[][];

interface SelectedCell {
  bed: Bed;
  row: number;
  col: number;
  planting: Planting | null;
}

export function buildGrid(rows: number, cols: number, plantings: Planting[]): Grid {
  const byCell = new Map(plantings.map((p) => [cellKey(p.cell_row, p.cell_col), p]));
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => byCell.get(cellKey(r, c)) ?? null),
  );
}

@Component({
  selector: 'app-garden-layout',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './garden-layout.component.html',
  styles: `
    table { border-collapse: collapse; }
    td { padding: 0; }
    td button { width: 5.5rem; height: 3.5rem; border: 1px solid #8a9a5b; background: #f4f7ec; cursor: pointer; overflow: hidden; }
    td button.planted { background: #cfe3b0; }
    td button.selected { outline: 3px solid #3b6e22; outline-offset: -3px; }
  `,
})
export class GardenLayoutComponent {
  private garden = inject(GardenService);
  private catalog = inject(PlantCatalogService);

  loading = signal(true);
  error = signal<string | null>(null);
  beds = signal<Bed[]>([]);
  grids = signal<Record<string, Grid>>({});

  plants = signal<Plant[]>([]);
  /** Plant names for the grid; your own copies are marked so they're distinguishable from built-ins. */
  private plantLabels = computed(
    () => new Map(this.plants().map((p) => [p.id, p.user_id ? `${p.name} (yours)` : p.name])),
  );
  plantOptions = computed(() =>
    [...this.plants()].sort((a, b) => a.name.localeCompare(b.name) || Number(!!a.user_id) - Number(!!b.user_id)),
  );

  selected = signal<SelectedCell | null>(null);
  newPlantId = signal('');
  newPlantedDate = signal(toIsoDate(new Date()));
  cellError = signal<string | null>(null);
  busy = signal(false);

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      const [beds, plants] = await Promise.all([this.garden.listBeds(), this.catalog.list()]);
      this.plants.set(plants);
      this.beds.set(beds);
      await Promise.all(beds.map((bed) => this.refreshBed(bed)));
    } catch (e) {
      this.error.set(`Could not load your garden: ${messageOf(e)}`);
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshBed(bed: Bed): Promise<void> {
    const plantings = await this.garden.listActivePlantings(bed.id);
    this.grids.update((grids) => ({ ...grids, [bed.id]: buildGrid(bed.rows, bed.cols, plantings) }));
  }

  plantLabel(plantId: string): string {
    return this.plantLabels().get(plantId) ?? 'Unknown plant';
  }

  isSelected(bed: Bed, row: number, col: number): boolean {
    const s = this.selected();
    return !!s && s.bed.id === bed.id && s.row === row && s.col === col;
  }

  selectCell(bed: Bed, row: number, col: number, planting: Planting | null): void {
    this.selected.set({ bed, row, col, planting });
    this.newPlantId.set('');
    this.newPlantedDate.set(toIsoDate(new Date()));
    this.cellError.set(null);
  }

  closePanel(): void {
    this.selected.set(null);
    this.cellError.set(null);
  }

  async assign(event: Event): Promise<void> {
    event.preventDefault();
    const cell = this.selected();
    if (!cell) return;
    if (!this.newPlantId()) return this.cellError.set('Choose a plant.');
    if (!this.newPlantedDate()) return this.cellError.set('Choose a planting date.');
    await this.runOnCell(cell, () =>
      this.garden.assignPlanting(cell.bed.id, cell.row, cell.col, this.newPlantId(), this.newPlantedDate()),
    );
  }

  async remove(): Promise<void> {
    const cell = this.selected();
    if (!cell?.planting) return;
    const plantingId = cell.planting.id;
    await this.runOnCell(cell, () => this.garden.removePlanting(plantingId));
  }

  /** Runs a cell change, then refreshes the bed; on failure keeps the panel open with the error. */
  private async runOnCell(cell: SelectedCell, change: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.cellError.set(null);
    try {
      await change();
      this.selected.set(null);
    } catch (e) {
      this.cellError.set(messageOf(e));
    } finally {
      this.busy.set(false);
    }
    // Refresh either way: after a conflict the grid may be stale.
    await this.refreshBed(cell.bed).catch((e) => this.error.set(`Could not refresh ${cell.bed.name}: ${messageOf(e)}`));
  }
}
