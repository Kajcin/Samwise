import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase-client';
import { currentUserId } from '../core/current-user';
import type { Lang } from '../core/i18n/i18n';
import { plantName, plantNotes, ruleNotes } from './labels';
import type { GrowthForm, LifeCycle, PlantUse } from './traits';

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
  notes: string | null;
  /** Czech notes; built-in plants only. */
  notes_cs?: string | null;
  /** A page describing the plant (e.g. a nursery's product page); Samwise only links to it. */
  source_url?: string | null;
  /** What kind of plant it is (migration 0015); see traits.ts. */
  life_cycle?: LifeCycle | null;
  growth_form?: GrowthForm | null;
  uses?: PlantUse[];
  /** Months 1-12, sorted (migration 0016); a plant can have two seasons, e.g. spinach. */
  flowering_months?: number[];
  harvest_months?: number[];
}

export type NewPlant = Omit<Plant, 'id' | 'user_id' | 'name_cs' | 'notes_cs'>;

/** The fields of your own plant that you can edit. */
export type PlantChanges = Partial<
  Pick<
    Plant,
    | 'name'
    | 'species'
    | 'sun_requirements'
    | 'watering_frequency_days'
    | 'flowering_months'
    | 'harvest_months'
    | 'notes'
    | 'source_url'
    | 'life_cycle'
    | 'growth_form'
    | 'uses'
  >
>;

/** The plant is in a bed right now, so it can't be deleted (migration 0017). */
export class PlantInGardenError extends Error {
  constructor(readonly beds: string[]) {
    super(`This plant is in a bed (${beds.join(', ')}), so it cannot be deleted.`);
    this.name = 'PlantInGardenError';
  }
}

/** What deleting a plant would mean (plant_deletion_check, migration 0017). */
export interface PlantDeletionCheck {
  /** The beds it's in now; while there are any, it can't be deleted. */
  activeBeds: string[];
  /** Completed tasks of its past plantings, deleted with it (also from the calendar). */
  completedTasks: number;
}

export type TaskType =
  | 'seed_start'
  | 'transplant'
  | 'prune'
  | 'fertilize'
  | 'harvest'
  | 'divide'
  | 'mulch'
  | 'winter_protection'
  | 'cut_back';

export interface CareRule {
  id: string;
  plant_id: string;
  task_type: TaskType;
  /** yearly: every year during `month` (perennials); a month-long task (migration 0012). */
  timing_type: 'offset_from_planting' | 'recurring' | 'yearly';
  offset_days: number | null;
  recurrence_days: number | null;
  /** 1-12, yearly rules only. */
  month?: number | null;
  /** Yearly rules: early = 1st-15th, late = 16th-last day, null = the whole month (migration 0013). */
  month_part?: MonthPart | null;
  notes: string | null;
  /** Czech notes; rules of built-in plants only. */
  notes_cs?: string | null;
}

export type NewCareRule = Omit<CareRule, 'id' | 'plant_id' | 'notes_cs'>;

export type MonthPart = 'early' | 'late';

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

  /** Updates one of your own plants (RLS refuses other plants). */
  async updatePlant(plantId: string, changes: PlantChanges): Promise<Plant> {
    const { data, error } = await supabase.from('plants_catalog').update(changes).eq('id', plantId).select().single();
    if (error) throw error;
    return data as Plant;
  }

  async deletionCheck(plantId: string): Promise<PlantDeletionCheck> {
    const { data, error } = await supabase.rpc('plant_deletion_check', { p_plant_id: plantId }).single();
    if (error) throw error;
    const row = data as { active_beds: string[] | null; completed_tasks: number };
    return { activeBeds: row.active_beds ?? [], completedTasks: row.completed_tasks };
  }

  /**
   * Deletes one of your own plants with its care rules, photos, past plantings and their
   * tasks; refused (PlantInGardenError) while it's in a bed.
   */
  async deletePlant(plantId: string): Promise<void> {
    // The photo rows go with the plant (cascade); their uploaded files are removed here.
    const { data: uploads } = await supabase
      .from('plant_photos')
      .select('storage_path')
      .eq('plant_id', plantId)
      .not('storage_path', 'is', null);
    const { error } = await supabase.rpc('delete_plant', { p_plant_id: plantId });
    if (error?.message === 'plant_in_garden') {
      throw new PlantInGardenError((error.details ?? '').split(', ').filter(Boolean));
    }
    if (error) throw error;
    const paths = (uploads ?? []).map((u) => u.storage_path as string);
    if (paths.length) await supabase.storage.from('plant-photos').remove(paths);
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

  /** Tasks already generated from the rule stay; it only affects future plantings. */
  async deleteCareRule(ruleId: string): Promise<void> {
    const { error } = await supabase.from('care_rules').delete().eq('id', ruleId);
    if (error) throw error;
  }

  async updateCareRule(ruleId: string, changes: Partial<NewCareRule>): Promise<void> {
    const { error } = await supabase.from('care_rules').update(changes).eq('id', ruleId);
    if (error) throw error;
  }
}
