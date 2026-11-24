import type { IconName } from '../core/icons/icons.generated';
import type { Plant } from './plant-catalog.service';
import type { SunRequirement } from './labels';

// What kind of plant it is (migration 0015). Texts: the "traits" section of src/i18n/{en,cs}.json.

/** How it's grown here (a carrot is grown as an annual); one per plant. */
export type LifeCycle = 'annual' | 'biennial' | 'perennial' | 'bulb';
export const LIFE_CYCLES: readonly LifeCycle[] = ['annual', 'biennial', 'perennial', 'bulb'];

/** Its shape; one per plant. */
export type GrowthForm = 'herbaceous' | 'subshrub' | 'shrub' | 'tree' | 'climber';
export const GROWTH_FORMS: readonly GrowthForm[] = ['herbaceous', 'subshrub', 'shrub', 'tree', 'climber'];

/** What it's grown for; a plant can have several. */
export type PlantUse = 'vegetable' | 'fruit' | 'herb' | 'ornamental';
export const PLANT_USES: readonly PlantUse[] = ['vegetable', 'fruit', 'herb', 'ornamental'];

export const lifeCycleKey = (value: LifeCycle) => `traits.lifeCycles.${value}`;
export const growthFormKey = (value: GrowthForm) => `traits.growthForms.${value}`;
export const useKey = (value: PlantUse) => `traits.uses.${value}`;

/**
 * Shrubs and trees have no life cycle here: Czech gardening's "trvalka" means a
 * herbaceous perennial, so a currant bush isn't one. The database checks it too.
 */
export function hasLifeCycle(form: GrowthForm | null | undefined): boolean {
  return form !== 'shrub' && form !== 'tree';
}

/**
 * Most plants are herbaceous, and "bylina" reads almost like the "bylinka" (herb)
 * use chip, so that growth form gets no chip; the others do.
 */
export function showsGrowthFormChip(form: GrowthForm | null | undefined): form is GrowthForm {
  return !!form && form !== 'herbaceous';
}

/** The catalog's filters: within a group any value matches; every group with values must match. */
export interface PlantFilters {
  lifeCycles: readonly LifeCycle[];
  growthForms: readonly GrowthForm[];
  uses: readonly PlantUse[];
}

export const NO_FILTERS: PlantFilters = { lifeCycles: [], growthForms: [], uses: [] };

export function activeFilterCount(filters: PlantFilters): number {
  return filters.lifeCycles.length + filters.growthForms.length + filters.uses.length;
}

export function matchesFilters(plant: Plant, filters: PlantFilters): boolean {
  const { lifeCycles, growthForms, uses } = filters;
  if (lifeCycles.length && !(plant.life_cycle && lifeCycles.includes(plant.life_cycle))) return false;
  if (growthForms.length && !(plant.growth_form && growthForms.includes(plant.growth_form))) return false;
  if (uses.length && !(plant.uses ?? []).some((use) => uses.includes(use))) return false;
  return true;
}

/** Adds the value to the list, or takes it out if it's there (a filter button, a use checkbox). */
export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** A sun, a sun behind a cloud, a cloud. */
export const SUN_ICONS: Record<SunRequirement, IconName> = {
  full_sun: 'sun-fill',
  partial_shade: 'cloud-sun',
  full_shade: 'cloud',
};

/** The two seasons a plant can have, each a set of months (migration 0016). */
export type Season = 'flowering' | 'harvest';

/**
 * The months as runs of consecutive months, e.g. [4, 5, 6, 9, 10] -> [[4, 6], [9, 10]].
 * A run may go over the new year: [1, 2, 12] -> [[12, 2]].
 */
export function monthRuns(months: readonly number[]): [number, number][] {
  const set = new Set(months.filter((m) => m >= 1 && m <= 12));
  if (set.size === 12) return [[1, 12]];
  const next = (m: number) => (m % 12) + 1;
  const previous = (m: number) => ((m + 10) % 12) + 1;
  const runs: [number, number][] = [];
  for (const start of [...set].sort((a, b) => a - b)) {
    if (set.has(previous(start))) continue; // not the first month of its run
    let end = start;
    while (set.has(next(end))) end = next(end);
    runs.push([start, end]);
  }
  return runs;
}

export type Translate = (key: string, params?: Record<string, unknown>) => string;

/** "May to September", "April to June, September to October", "July". */
export function describeMonths(months: readonly number[], t: Translate): string {
  return monthRuns(months)
    .map(([from, to]) =>
      from === to ? t(`months.${from}`) : t('traits.monthRange', { from: t(`months.${from}`), to: t(`months.${to}`) }),
    )
    .join(', ');
}

/** Grown to be eaten (or used in the kitchen): harvest is the season that matters. */
export function isEdible(plant: Pick<Plant, 'uses'>): boolean {
  return (plant.uses ?? []).some((use) => use === 'vegetable' || use === 'fruit' || use === 'herb');
}

/**
 * The one season the catalog shows for a plant: the harvest of edible plants (when it's
 * known), otherwise flowering.
 */
export function catalogSeason(plant: Pick<Plant, 'uses' | 'flowering_months' | 'harvest_months'>): {
  kind: Season;
  months: readonly number[];
} {
  const harvest = plant.harvest_months ?? [];
  if (isEdible(plant) && harvest.length) return { kind: 'harvest', months: harvest };
  return { kind: 'flowering', months: plant.flowering_months ?? [] };
}
