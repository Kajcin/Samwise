import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase-client';
import { currentUserId } from '../core/current-user';

export interface Bed {
  id: string;
  user_id: string;
  name: string;
  rows: number;
  cols: number;
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
