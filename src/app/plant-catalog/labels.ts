import { CareRule, Plant, TaskType } from './plant-catalog.service';

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  seed_start: 'Seed start',
  transplant: 'Transplant',
  prune: 'Prune',
  fertilize: 'Fertilize',
  harvest: 'Harvest',
};

export const TASK_TYPES = Object.keys(TASK_TYPE_LABELS) as TaskType[];

export const SUN_LABELS: Record<NonNullable<Plant['sun_requirements']>, string> = {
  full_sun: 'Full sun',
  partial_shade: 'Partial shade',
  full_shade: 'Full shade',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? String(month);
}

export function describeRuleTiming(rule: Pick<CareRule, 'timing_type' | 'offset_days' | 'recurrence_days'>): string {
  if (rule.timing_type === 'recurring') {
    return rule.recurrence_days === 1 ? 'every day' : `every ${rule.recurrence_days} days`;
  }
  if (rule.offset_days === 0) return 'on planting day';
  return rule.offset_days === 1 ? '1 day after planting' : `${rule.offset_days} days after planting`;
}
