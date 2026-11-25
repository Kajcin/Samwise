import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase-client';
import { currentUserId } from '../core/current-user';

export interface Bed {
  id: string;
  user_id: string;
  name: string;
  /** rows × cols is the bed's box; `gaps` are the positions in it that aren't part of the bed. */
  rows: number;
  cols: number;
  /** [row, col] pairs, 0-based (migration 0018): an L-shaped bed, a path through it. */
  gaps?: [number, number][];
}

export interface Planting {
  id: string;
  user_id: string;
  bed_id: string;
  cell_row: number;
  cell_col: number;
  plant_id: string;
  /** ISO date, YYYY-MM-DD. */
  planted_date: string;
  status: 'active' | 'removed';
}

/** Thrown when assigning a plant to a cell that already has an active planting. */
export class CellOccupiedError extends Error {
  constructor(readonly row: number, readonly col: number) {
    super('That cell already has a plant. Remove it first.');
    this.name = 'CellOccupiedError';
  }
}

const UNIQUE_VIOLATION = '23505';

/** Whether (row, col) is a gap of the bed rather than a slot. */
export function isGap(bed: Pick<Bed, 'gaps'>, row: number, col: number): boolean {
  return (bed.gaps ?? []).some(([r, c]) => r === row && c === col);
}

/** How many slots (cells a plant can go in) the bed has. */
export function slotCount(bed: Pick<Bed, 'rows' | 'cols' | 'gaps'>): number {
  return bed.rows * bed.cols - (bed.gaps ?? []).length;
}

/** Why the database refused a bed edit (add_bed_slot, remove_bed_slot, delete_bed: migration 0018). */
export type BedEditRefusal = 'slot_last' | 'bed_too_large' | 'bed_not_empty' | 'slot_exists' | 'slot_not_adjacent' | 'slot_not_found';
const REFUSALS: readonly string[] = ['slot_last', 'bed_too_large', 'bed_not_empty', 'slot_exists', 'slot_not_adjacent', 'slot_not_found'];

export class BedEditError extends Error {
  constructor(readonly code: BedEditRefusal) {
    super(`The bed edit was refused: ${code}`);
    this.name = 'BedEditError';
  }
}

function bedEditError(error: { message: string }): Error {
  return REFUSALS.includes(error.message) ? new BedEditError(error.message as BedEditRefusal) : (error as Error);
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

@Injectable({ providedIn: 'root' })
export class GardenService {
  async listBeds(): Promise<Bed[]> {
    const { data, error } = await supabase.from('beds').select('*').order('name');
    if (error) throw error;
    return data as Bed[];
  }

  async getBed(bedId: string): Promise<Bed> {
    const { data, error } = await supabase.from('beds').select('*').eq('id', bedId).single();
    if (error) throw error;
    return data as Bed;
  }

  async createBed(name: string, rows: number, cols: number): Promise<Bed> {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('beds')
      .insert({ name, rows, cols, user_id: userId })
      .select()
      .single();
    if (error) throw error;
    return data as Bed;
  }

  /**
   * Adds a slot: a gap of the bed, or a spot next to its edge (the bed grows; at the top
   * or the left its plants move along). Returns the bed as it is now.
   */
  async addSlot(bedId: string, row: number, col: number): Promise<Bed> {
    const { data, error } = await supabase.rpc('add_bed_slot', { p_bed_id: bedId, p_row: row, p_col: col });
    if (error) throw bedEditError(error);
    return data as Bed;
  }

  /** Removes a slot, taking out the plant in it (kept as history); the bed shrinks to fit. */
  async removeSlot(bedId: string, row: number, col: number): Promise<Bed> {
    const { data, error } = await supabase.rpc('remove_bed_slot', { p_bed_id: bedId, p_row: row, p_col: col });
    if (error) throw bedEditError(error);
    return data as Bed;
  }

  async renameBed(bedId: string, name: string): Promise<Bed> {
    const { data, error } = await supabase.from('beds').update({ name }).eq('id', bedId).select().single();
    if (error) throw error;
    return data as Bed;
  }

  /** Deletes an empty bed with its history; refused (bed_not_empty) while something grows in it. */
  async deleteBed(bedId: string): Promise<void> {
    const { error } = await supabase.rpc('delete_bed', { p_bed_id: bedId });
    if (error) throw bedEditError(error);
  }

  async listActivePlantings(bedId: string): Promise<Planting[]> {
    const { data, error } = await supabase
      .from('plantings')
      .select('*')
      .eq('bed_id', bedId)
      .eq('status', 'active');
    if (error) throw error;
    return data as Planting[];
  }

  async assignPlanting(bedId: string, row: number, col: number, plantId: string, plantedDate: string): Promise<Planting> {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('plantings')
      .insert({
        bed_id: bedId,
        cell_row: row,
        cell_col: col,
        plant_id: plantId,
        planted_date: plantedDate,
        status: 'active',
        user_id: userId,
      })
      .select()
      .single();
    if (error) {
      // plantings_one_active_per_cell is the only unique constraint a client insert can hit.
      if (error.code === UNIQUE_VIOLATION) throw new CellOccupiedError(row, col);
      throw error;
    }
    return data as Planting;
  }

  /** Soft-removes the planting (kept for history); frees the cell for a new planting. */
  async removePlanting(plantingId: string): Promise<void> {
    const { error } = await supabase.from('plantings').update({ status: 'removed' }).eq('id', plantingId);
    if (error) throw error;
  }
}
