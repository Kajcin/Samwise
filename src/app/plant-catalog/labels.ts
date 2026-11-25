import type { CareRule, Plant, TaskType } from './plant-catalog.service';
import type { IconName } from '../core/icons/icons.generated';
import { Lang, Message, msg } from '../core/i18n/i18n';
import { monthRuns } from './traits';

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

/** "May to September, November" as one message (runs joined by commas); months not empty. */
function monthsMessage(months: readonly number[]): Message {
  const runs = monthRuns(months).map(([from, to]) =>
    from === to ? msg(monthKey(from)) : msg('traits.monthRange', { from: msg(monthKey(from)), to: msg(monthKey(to)) }),
  );
  return runs.reduceRight((rest, run) => msg('rules.monthList', { first: run, rest }));
}

export function describeRuleTiming(
  rule: Pick<CareRule, 'timing_type' | 'offset_days' | 'recurrence_days' | 'month' | 'month_part' | 'months' | 'season'>,
): Message {
  if (rule.timing_type === 'yearly') {
    // "every year in early May" / "každý rok začátkem května" (the month as "of May").
    if (rule.month_part === 'early') return msg('rules.yearlyEarly', { month: msg(`dates.monthOf.${rule.month}`) });
    if (rule.month_part === 'late') return msg('rules.yearlyLate', { month: msg(`dates.monthOf.${rule.month}`) });
    // One text per month: Czech says "v červenci", "v září", … (each month its own form).
    return msg(`rules.yearly.${rule.month}`);
  }
  if (rule.timing_type === 'recurring') {
    // "every 7 days (July to September)", "every 7 days during harvest".
    const every = msg('rules.everyDays', { days: rule.recurrence_days });
    if (rule.season === 'harvest') return msg('rules.everyDaysInHarvest', { every });
    if (rule.season === 'flowering') return msg('rules.everyDaysInFlowering', { every });
    if (rule.months?.length) return msg('rules.everyDaysInMonths', { every, months: monthsMessage(rule.months) });
    return every;
  }
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
