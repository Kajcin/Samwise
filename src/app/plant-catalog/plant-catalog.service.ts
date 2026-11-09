import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase-client';

export interface Plant {
  id: string;
  /** null = built-in catalog plant (read-only); otherwise the owner's id. */
  user_id: string | null;
  name: string;
  species: string | null;
  sun_requirements: 'full_sun' | 'partial_shade' | 'full_shade' | null;
  watering_frequency_days: number | null;
  flowering_start_month: number | null;
  flowering_end_month: number | null;
  notes: string | null;
}

export type NewPlant = Omit<Plant, 'id' | 'user_id'>;

export type TaskType = 'seed_start' | 'transplant' | 'prune' | 'fertilize' | 'harvest';

export interface CareRule {
  id: string;
  plant_id: string;
  task_type: TaskType;
  timing_type: 'offset_from_planting' | 'recurring';
  offset_days: number | null;
  recurrence_days: number | null;
  notes: string | null;
}

export type NewCareRule = Omit<CareRule, 'id' | 'plant_id'>;

@Injectable({ providedIn: 'root' })
export class PlantCatalogService {
  /** Built-in plants plus the current user's custom plants (RLS filters the rest). */
  async list(): Promise<Plant[]> {
    const { data, error } = await supabase.from('plants_catalog').select('*').order('name');
    if (error) throw error;
    return data as Plant[];
  }

  async addCustom(plant: NewPlant): Promise<Plant> {
    const userId = await this.currentUserId();
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
   * current user's catalog, so the copy's rules can be edited.
   */
  async cloneToCustom(plantId: string): Promise<Plant> {
    const { data: source, error: sourceError } = await supabase
      .from('plants_catalog')
      .select('*')
      .eq('id', plantId)
      .single();
    if (sourceError) throw sourceError;

    const { data: rules, error: rulesError } = await supabase
      .from('care_rules')
      .select('task_type,timing_type,offset_days,recurrence_days,notes')
      .eq('plant_id', plantId);
    if (rulesError) throw rulesError;

    const userId = await this.currentUserId();
    const { id: _id, user_id: _owner, ...fields } = source as Plant;
    const { data: clone, error: cloneError } = await supabase
      .from('plants_catalog')
      .insert({ ...fields, user_id: userId })
      .select()
      .single();
    if (cloneError) throw cloneError;

    if (rules && rules.length) {
      const { error: insertRulesError } = await supabase
        .from('care_rules')
        .insert(rules.map((r) => ({ ...r, plant_id: (clone as Plant).id })));
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

  private async currentUserId(): Promise<string> {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('Not signed in');
    return data.user.id;
  }
}
