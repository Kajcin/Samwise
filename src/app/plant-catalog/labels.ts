import type { CareRule, Plant, TaskType } from './plant-catalog.service';
import type { IconName } from '../core/icons/icons.generated';
import { Lang, Message, msg } from '../core/i18n/i18n';

// Texts live in src/i18n/{en,cs}.json; these are their keys.

export const TASK_TYPES: readonly TaskType[] = [
  'seed_start',
  'transplant',
  'prune',
  'cut_back',
  'fertilize',
  'mulch',
  'divide',
  'winter_protection',
  'harvest',
];

export const taskTypeKey = (type: TaskType) => `taskTypes.${type}`;

/** Shown next to each task (Bootstrap Icons has no seedling, so seed start gets a flower). */
export const TASK_TYPE_ICONS: Record<TaskType, IconName> = {
  seed_start: 'flower1',
  transplant: 'bucket',
  prune: 'scissors',
  fertilize: 'droplet',
  harvest: 'basket',
  divide: 'grid-1x2',
  mulch: 'layers',
  winter_protection: 'snow',
  cut_back: 'arrows-collapse-vertical',
};

export type SunRequirement = NonNullable<Plant['sun_requirements']>;
export const SUN_REQUIREMENTS: readonly SunRequirement[] = ['full_sun', 'partial_shade', 'full_shade'];
export const sunKey = (sun: SunRequirement) => `sun.${sun}`;

/** Month 1-12, as it stands alone ("June" / "červen"). */
export const monthKey = (month: number) => `months.${month}`;

export function describeRuleTiming(
  rule: Pick<CareRule, 'timing_type' | 'offset_days' | 'recurrence_days' | 'month'>,
): Message {
  // One text per month: Czech says "v červenci", "v září", … (each month its own form).
  if (rule.timing_type === 'yearly') return msg(`rules.yearly.${rule.month}`);
  if (rule.timing_type === 'recurring') return msg('rules.everyDays', { days: rule.recurrence_days });
  if (rule.offset_days === 0) return msg('rules.onPlantingDay');
  return msg('rules.daysAfterPlanting', { days: rule.offset_days });
}

// Built-in plants carry Czech texts (name_cs, notes_cs); a user's own plants don't,
// and show what the user typed, whatever the language.

export function plantName(plant: Pick<Plant, 'name' | 'name_cs'>, lang: Lang): string {
  return (lang === 'cs' && plant.name_cs) || plant.name;
}

export function plantNotes(plant: Pick<Plant, 'notes' | 'notes_cs'>, lang: Lang): string | null {
  return (lang === 'cs' && plant.notes_cs) || plant.notes;
}

export function ruleNotes(rule: Pick<CareRule, 'notes' | 'notes_cs'>, lang: Lang): string | null {
  return (lang === 'cs' && rule.notes_cs) || rule.notes;
}
