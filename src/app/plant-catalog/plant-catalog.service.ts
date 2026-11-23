import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase-client';
import { currentUserId } from '../core/current-user';
import type { Lang } from '../core/i18n/i18n';
import { plantName, plantNotes, ruleNotes } from './labels';

export interface Plant {
  id: string;
  /** null = built-in catalog plant (read-only); otherwise the owner's id. */
  user_id: string | null;
  name: string;
  /** Czech name; built-in plants only (migration 0009). */
  name_cs?: string | null;
  species: string | null;
  sun_requirements: 'full_sun' | 'partial_shade' | 'full_shade' | null;
  watering_frequency_days: number | null;
  flowering_start_month: number | null;
  flowering_end_month: number | null;
  notes: string | null;
  /** Czech notes; built-in plants only. */
  notes_cs?: string | null;
}

export type NewPlant = Omit<Plant, 'id' | 'user_id' | 'name_cs' | 'notes_cs'>;

export type TaskType = 'seed_start' | 'transplant' | 'prune' | 'fertilize' | 'harvest';

export interface CareRule {
  id: string;
  plant_id: string;
  task_type: TaskType;
  timing_type: 'offset_from_planting' | 'recurring';
  offset_days: number | null;
  recurrence_days: number | null;
  notes: string | null;
  /** Czech notes; rules of built-in plants only. */
  notes_cs?: string | null;
}

export type NewCareRule = Omit<CareRule, 'id' | 'plant_id' | 'notes_cs'>;

@Injectable({ providedIn: 'root' })
export class PlantCatalogService {
  /** Built-in plants plus the current user's custom plants (RLS filters the rest). */
  async list(): Promise<Plant[]> {
    const { data, error } = await supabase.from('plants_catalog').select('*').order('name');
    if (error) throw error;
    return data as Plant[];
  }

  async get(plantId: string): Promise<Plant> {
    const { data, error } = await supabase.from('plants_catalog').select('*').eq('id', plantId).single();
    if (error) throw error;
    return data as Plant;
  }

  async addCustom(plant: NewPlant): Promise<Plant> {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('plants_catalog')
      .insert({ ...plant, user_id: userId })
      .select()
      .single();
    if (error) throw error;
    return data as Plant;
  }

  /**
   * Copies a plant (usually a built-in one) and its care rules into the
   * current user's catalog, so the copy's rules can be edited. The copy gets the
   * name and notes in `lang` as its own texts (it has no translations: it's the
   * user's now, and shows what they type).
   */
  async cloneToCustom(plantId: string, lang: Lang = 'en'): Promise<Plant> {
    const { data: source, error: sourceError } = await supabase
      .from('plants_catalog')
      .select('*')
      .eq('id', plantId)
      .single();
    if (sourceError) throw sourceError;

    const { data: rules, error: rulesError } = await supabase
      .from('care_rules')
      .select('task_type,timing_type,offset_days,recurrence_days,notes,notes_cs')
      .eq('plant_id', plantId);
    if (rulesError) throw rulesError;

    const userId = await currentUserId();
    const { id: _id, user_id: _owner, name_cs: _nameCs, notes_cs: _notesCs, ...fields } = source as Plant;
    const { data: clone, error: cloneError } = await supabase
      .from('plants_catalog')
      .insert({
        ...fields,
        name: plantName(source as Plant, lang),
        notes: plantNotes(source as Plant, lang),
        user_id: userId,
      })
      .select()
      .single();
    if (cloneError) throw cloneError;

    if (rules && rules.length) {
      const { error: insertRulesError } = await supabase
        .from('care_rules')
        .insert(
          rules.map(({ notes_cs: _rNotesCs, ...r }) => ({
            ...r,
            notes: ruleNotes({ notes: r.notes, notes_cs: _rNotesCs }, lang),
            plant_id: (clone as Plant).id,
          })),
        );
      if (insertRulesError) throw insertRulesError;
    }

    return clone as Plant;
  }

  async listCareRules(plantId: string): Promise<CareRule[]> {
    const { data, error } = await supabase.from('care_rules').select('*').eq('plant_id', plantId);
    if (error) throw error;
    return data as CareRule[];
  }

  async addCareRule(plantId: string, rule: NewCareRule): Promise<CareRule> {
    const { data, error } = await supabase
      .from('care_rules')
      .insert({ ...rule, plant_id: plantId })
      .select()
      .single();
    if (error) throw error;
    return data as CareRule;
  }

  async updateCareRule(ruleId: string, changes: Partial<NewCareRule>): Promise<void> {
    const { error } = await supabase.from('care_rules').update(changes).eq('id', ruleId);
    if (error) throw error;
  }
}
