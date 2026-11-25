import { Component, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { SpinnerComponent } from '../core/loading/spinner.component';
import { LoadingComponent } from '../core/loading/loading.component';
import { ActivatedRoute, Router } from '@angular/router';
import { ModalComponent } from '../core/modal/modal.component';
import { parseNumberInput } from '../core/number-input';
import { MAX_BED_SIZE, validateBedForm } from './bed-form';
import { Bed, BedEditError, cellKey, CellOccupiedError, GardenService, isGap, Planting, slotCount } from './garden.service';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';
import { Plant, PlantCatalogService } from '../plant-catalog/plant-catalog.service';
import { messageOf } from '../core/errors';
import { toIsoDate } from '../core/dates';
import { Message, msg } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';
import { plantName } from '../plant-catalog/labels';
import { PlantPhoto, PlantPhotosService } from '../plant-catalog/plant-photos.service';

/** A position of the bed's box that isn't part of the bed. */
export const GAP = 'gap';
/** Each position of a bed's box: its planting, null for an empty slot, or GAP. */
export type GridCell = Planting | null | typeof GAP;
type Grid = GridCell[][];

/** A position in the bed's edit grid: a slot (removable), a "+" (adds a slot), or nothing. */
export interface EditCell {
  row: number;
  col: number;
  kind: 'slot' | 'add' | 'none';
  planting: Planting | null;
}

interface SelectedCell {
  bed: Bed;
  row: number;
  col: number;
  planting: Planting | null;
}

export function buildGrid(rows: number, cols: number, plantings: Planting[], gaps: [number, number][] = []): Grid {
  const byCell = new Map(plantings.map((p) => [cellKey(p.cell_row, p.cell_col), p]));
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (isGap({ gaps }, r, c) ? GAP : (byCell.get(cellKey(r, c)) ?? null))),
  );
}

/**
 * The bed's box with a ring around it, for editing: its slots, a "+" in each gap and in
 * each spot next to a slot just outside the box (not past the size limit), else nothing.
 * Mirrors add_bed_slot (migration 0018).
 */
export function buildEditGrid(bed: Pick<Bed, 'rows' | 'cols'>, grid: Grid, maxSize: number): EditCell[][] {
  const slot = (r: number, c: number) => r >= 0 && r < bed.rows && c >= 0 && c < bed.cols && grid[r]?.[c] !== GAP;
  const rows: EditCell[][] = [];
  for (let r = -1; r <= bed.rows; r++) {
    const row: EditCell[] = [];
    for (let c = -1; c <= bed.cols; c++) {
      if (slot(r, c)) {
        row.push({ row: r, col: c, kind: 'slot', planting: grid[r][c] as Planting | null });
        continue;
      }
      const inside = r >= 0 && r < bed.rows && c >= 0 && c < bed.cols;
      const touches = slot(r - 1, c) || slot(r + 1, c) || slot(r, c - 1) || slot(r, c + 1);
      const tooBig = ((r === -1 || r === bed.rows) && bed.rows >= maxSize) || ((c === -1 || c === bed.cols) && bed.cols >= maxSize);
      row.push({ row: r, col: c, kind: inside || (touches && !tooBig) ? 'add' : 'none', planting: null });
    }
    rows.push(row);
  }
  return rows;
}

@Component({
  selector: 'app-garden-layout',
  standalone: true,
  imports: [IconComponent, ModalComponent, SpinnerComponent, LoadingComponent],
  templateUrl: './garden-layout.component.html',
  styles: `
    .bed-grid { border-collapse: separate; border-spacing: 4px; }
    .bed-grid td { padding: 0; }
    .bed-grid button {
      width: 5.5rem;
      height: 3.5rem;
      padding: 0.25rem;
      border: 1px solid #b5c79a;
      border-radius: 0.5rem;
      background: #f4f7ec;
      color: #6c7a5a;
      font-size: 0.85rem;
      line-height: 1.1;
      overflow: hidden;
      cursor: pointer;
    }
    .bed-grid button:hover { border-color: #3b6e22; }
    .bed-grid button.planted { background: #cfe3b0; color: #2f5a1b; font-weight: 600; }
    /* With a photo: the picture fills the cell, the name sits on a dark band at the bottom. */
    .bed-grid button.with-photo { position: relative; padding: 0; color: #fff; }
    .bed-grid button.with-photo img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .bed-grid button.with-photo .cell-name {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 0.1rem 0.2rem;
      background: linear-gradient(transparent, rgba(0, 0, 0, 0.65));
      font-size: 0.75rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    }
    .bed-grid .cell-spacer { display: block; width: 5.5rem; height: 3.5rem; }
    /* Editing: "+" adds a slot; a slot shows a ✕ and is removed when clicked. */
    .bed-grid button.add-slot {
      border-style: dashed;
      background: transparent;
      color: #3b6e22;
      font-size: 1.1rem;
    }
    .bed-grid button.add-slot:hover { background: #f4f7ec; }
    .bed-grid button.remove-slot { position: relative; }
    .bed-grid button.remove-slot .remove-mark {
      position: absolute;
      top: 0.15rem;
      right: 0.2rem;
      color: #b02a37;
      font-size: 0.85rem;
      line-height: 1;
    }
    .bed-grid button.remove-slot:hover { border-color: #b02a37; }
    .bed-grid button.remove-slot:disabled { cursor: not-allowed; opacity: 0.6; }
    .bed-name-input { max-width: 20rem; }
    .bed-grid button.selected { outline: 3px solid #3b6e22; outline-offset: 1px; }
    .bed-grid button:focus-visible { outline: 3px solid #3b6e22; outline-offset: 1px; }
  `,
})
export class GardenLayoutComponent {
  private garden = inject(GardenService);
  private catalog = inject(PlantCatalogService);
  private photosService = inject(PlantPhotosService);
  /** Your main photo of each plant, by plant id; empty until loaded (or if that fails). */
  mainPhotos = signal<ReadonlyMap<string, PlantPhoto>>(new Map());
  /** Plants whose photo didn't load: their cells look as without one. */
  brokenPhotos = signal<ReadonlySet<string>>(new Set());
  protected i18n = inject(LanguageService);

  loading = signal(true);
  error = signal<Message | null>(null);
  beds = signal<Bed[]>([]);
  grids = signal<Record<string, Grid>>({});

  plants = signal<Plant[]>([]);
  /**
   * Plant names for the grid, in the current language; your own copies are marked
   * so they're distinguishable from built-ins.
   */
  private plantLabels = computed(() => {
    const lang = this.i18n.lang();
    return new Map(
      this.plants().map((p) => {
        const name = plantName(p, lang);
        return [p.id, p.user_id ? this.i18n.t('garden.ownPlant', { name }) : name];
      }),
    );
  });
  plantOptions = computed(() => {
    const lang = this.i18n.lang();
    return [...this.plants()].sort(
      (a, b) => plantName(a, lang).localeCompare(plantName(b, lang), lang) || Number(!!a.user_id) - Number(!!b.user_id),
    );
  });

  selected = signal<SelectedCell | null>(null);
  newPlantId = signal('');
  newPlantedDate = signal(toIsoDate(new Date()));
  cellError = signal<Message | null>(null);
  busy = signal(false);

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmDialog = inject(ConfirmDialogService);

  protected readonly gap = GAP;
  protected readonly slotCount = slotCount;

  // Editing a bed: its id, the name being typed, what's running, and what went wrong.
  editingBedId = signal<string | null>(null);
  editName = signal('');
  /** The running edit: 'add:r:c', 'remove:r:c', 'delete' or 'rename'. */
  editBusy = signal<string | null>(null);
  editError = signal<Message | null>(null);

  // The "new bed" dialog.
  protected readonly maxBedSize = MAX_BED_SIZE;
  protected readonly parseNumber = parseNumberInput;
  bedDialogOpen = signal(false);
  newBedName = signal('');
  newBedRows = signal<number | null>(3);
  newBedCols = signal<number | null>(3);
  bedError = signal<Message | null>(null);
  savingBed = signal(false);

  constructor() {
    // /garden?newBed=1 (e.g. the dashboard's "create your first bed") opens the dialog.
    if (this.route.snapshot.queryParamMap.has('newBed')) {
      this.openBedDialog();
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
    this.load();
  }

  openBedDialog(): void {
    this.newBedName.set('');
    this.newBedRows.set(3);
    this.newBedCols.set(3);
    this.bedError.set(null);
    this.bedDialogOpen.set(true);
  }

  /** Closes the dialog; what was typed is dropped. */
  closeBedDialog(): void {
    this.bedDialogOpen.set(false);
    this.bedError.set(null);
  }

  async saveBed(event: Event): Promise<void> {
    event.preventDefault();
    const rows = this.newBedRows();
    const cols = this.newBedCols();
    const validation = validateBedForm(this.newBedName(), rows, cols);
    this.bedError.set(validation);
    if (validation) return;
    this.savingBed.set(true);
    try {
      const bed = await this.garden.createBed(this.newBedName().trim(), rows!, cols!);
      this.beds.update((list) => [...list, bed].sort((a, b) => a.name.localeCompare(b.name, this.i18n.lang())));
      this.grids.update((grids) => ({ ...grids, [bed.id]: buildGrid(bed.rows, bed.cols, []) }));
      this.bedDialogOpen.set(false);
    } catch (e) {
      this.bedError.set(msg('bedEditor.errors.save', { detail: messageOf(e) }));
    } finally {
      this.savingBed.set(false);
    }
  }

  /** The garden works without photos, so a failure here is only logged. */
  private async loadMainPhotos(): Promise<void> {
    try {
      this.mainPhotos.set(await this.photosService.mainPhotos());
    } catch (e) {
      console.error('Could not load the plant photos:', messageOf(e));
    }
  }

  /** A planted cell's photo, unless it failed to load. */
  cellPhoto(plantId: string): PlantPhoto | null {
    return this.brokenPhotos().has(plantId) ? null : (this.mainPhotos().get(plantId) ?? null);
  }

  markPhotoBroken(plantId: string): void {
    this.brokenPhotos.update((set) => new Set(set).add(plantId));
  }

  private async load(): Promise<void> {
    this.loadMainPhotos();
    try {
      const [beds, plants] = await Promise.all([this.garden.listBeds(), this.catalog.list()]);
      this.plants.set(plants);
      this.beds.set(beds);
      await Promise.all(beds.map((bed) => this.refreshBed(bed)));
    } catch (e) {
      this.error.set(msg('garden.errors.load', { detail: messageOf(e) }));
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshBed(bed: Bed): Promise<void> {
    const plantings = await this.garden.listActivePlantings(bed.id);
    this.grids.update((grids) => ({ ...grids, [bed.id]: buildGrid(bed.rows, bed.cols, plantings, bed.gaps) }));
  }

  editGrid(bed: Bed): EditCell[][] {
    return buildEditGrid(bed, this.grids()[bed.id] ?? [], MAX_BED_SIZE);
  }

  startEditing(bed: Bed): void {
    this.selected.set(null);
    this.editingBedId.set(bed.id);
    this.editName.set(bed.name);
    this.editError.set(null);
  }

  /** Saves the name if it changed, and leaves edit mode. */
  async finishEditing(event: Event, bed: Bed): Promise<void> {
    event.preventDefault();
    const name = this.editName().trim();
    if (!name) return this.editError.set(msg('bedEditor.errors.nameRequired'));
    if (name !== bed.name) {
      const renamed = await this.runEdit('rename', () => this.garden.renameBed(bed.id, name));
      if (!renamed) return;
      this.replaceBed(renamed);
    }
    this.editingBedId.set(null);
    this.editError.set(null);
  }

  async addSlot(bed: Bed, cell: EditCell): Promise<void> {
    const updated = await this.runEdit(`add:${cell.row}:${cell.col}`, () => this.garden.addSlot(bed.id, cell.row, cell.col));
    if (updated) await this.afterShapeChange(updated);
  }

  /** A slot with a plant asks first: the plant comes out with it. */
  async removeSlot(bed: Bed, cell: EditCell): Promise<void> {
    if (cell.planting) {
      const confirmed = await this.confirmDialog.ask({
        title: this.i18n.t('garden.removeSlotTitle'),
        message: this.i18n.t('garden.removeSlotMessage', { plant: this.plantLabel(cell.planting.plant_id) }),
        confirmLabel: this.i18n.t('garden.removeSlotConfirm'),
        cancelLabel: this.i18n.t('common.cancel'),
        danger: true,
        confirmIcon: 'trash',
      });
      if (!confirmed) return;
    }
    const updated = await this.runEdit(`remove:${cell.row}:${cell.col}`, () => this.garden.removeSlot(bed.id, cell.row, cell.col));
    if (updated) await this.afterShapeChange(updated);
  }

  /** Only an empty bed: the plants come out first (in the garden, or by removing their slots). */
  async deleteBed(bed: Bed): Promise<void> {
    const grid = this.grids()[bed.id] ?? [];
    if (grid.some((row) => row.some((cell) => !!cell && cell !== GAP))) {
      return this.editError.set(msg('garden.errors.bedNotEmpty'));
    }
    const confirmed = await this.confirmDialog.ask({
      title: this.i18n.t('garden.deleteBedTitle'),
      message: this.i18n.t('garden.deleteBedMessage', { name: bed.name }),
      confirmLabel: this.i18n.t('garden.deleteBedConfirm'),
      cancelLabel: this.i18n.t('common.cancel'),
      danger: true,
      confirmIcon: 'trash',
    });
    if (!confirmed) return;
    const deleted = await this.runEdit('delete', () => this.garden.deleteBed(bed.id).then(() => true));
    if (!deleted) return;
    this.beds.update((list) => list.filter((b) => b.id !== bed.id));
    this.grids.update(({ [bed.id]: _gone, ...rest }) => rest);
    this.editingBedId.set(null);
  }

  isEditBusy(key: string): boolean {
    return this.editBusy() === key;
  }

  /** Runs one edit; on failure shows why and resolves to null. */
  private async runEdit<T>(key: string, change: () => Promise<T>): Promise<T | null> {
    this.editBusy.set(key);
    this.editError.set(null);
    try {
      return await change();
    } catch (e) {
      this.editError.set(editErrorMessage(e));
      return null;
    } finally {
      this.editBusy.set(null);
    }
  }

  private replaceBed(updated: Bed): void {
    this.beds.update((list) => list.map((b) => (b.id === updated.id ? updated : b)));
  }

  /** After a slot came or went: the box may have changed and the plants may have moved. */
  private async afterShapeChange(updated: Bed): Promise<void> {
    this.replaceBed(updated);
    await this.refreshBed(updated).catch((e) =>
      this.error.set(msg('garden.errors.refresh', { bed: updated.name, detail: messageOf(e) })),
    );
  }

  plantLabel(plantId: string): string {
    return this.plantLabels().get(plantId) ?? this.i18n.t('garden.unknownPlant');
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
    if (!this.newPlantId()) return this.cellError.set(msg('garden.errors.choosePlant'));
    if (!this.newPlantedDate()) return this.cellError.set(msg('garden.errors.choosePlantingDate'));
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
      this.cellError.set(
        e instanceof CellOccupiedError ? msg('garden.errors.cellOccupied') : msg('garden.errors.action', { detail: messageOf(e) }),
      );
    } finally {
      this.busy.set(false);
    }
    // Refresh either way: after a conflict the grid may be stale.
    await this.refreshBed(cell.bed).catch((e) =>
      this.error.set(msg('garden.errors.refresh', { bed: cell.bed.name, detail: messageOf(e) })),
    );
  }
}

/** What to tell people when a bed edit fails. */
export function editErrorMessage(e: unknown): Message {
  if (e instanceof BedEditError) {
    if (e.code === 'slot_last') return msg('garden.errors.lastSlot');
    if (e.code === 'bed_too_large') return msg('garden.errors.tooLarge', { max: MAX_BED_SIZE });
    if (e.code === 'bed_not_empty') return msg('garden.errors.bedNotEmpty');
  }
  return msg('garden.errors.edit', { detail: messageOf(e) });
}
