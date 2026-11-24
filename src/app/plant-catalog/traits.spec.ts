import type { Plant } from './plant-catalog.service';
import {
  catalogSeason,
  describeMonths,
  hasLifeCycle,
  matchesFilters,
  monthRuns,
  NO_FILTERS,
  showsGrowthFormChip,
  toggled,
} from './traits';

function plant(overrides: Partial<Plant>): Plant {
  return {
    id: 'x', user_id: 'me', name: 'X', species: null, sun_requirements: 'full_sun', watering_frequency_days: null,
    notes: null, ...overrides,
  };
}

describe('matchesFilters', () => {
  const sage = plant({ life_cycle: 'perennial', growth_form: 'subshrub', uses: ['herb', 'ornamental'] });
  const unknown = plant({});

  it('lets every plant through without filters', () => {
    expect(matchesFilters(sage, NO_FILTERS)).toBeTrue();
    expect(matchesFilters(unknown, NO_FILTERS)).toBeTrue();
  });

  it('matches any value within a group', () => {
    expect(matchesFilters(sage, { ...NO_FILTERS, lifeCycles: ['annual', 'perennial'] })).toBeTrue();
    expect(matchesFilters(sage, { ...NO_FILTERS, uses: ['fruit', 'herb'] })).toBeTrue();
    expect(matchesFilters(sage, { ...NO_FILTERS, uses: ['fruit'] })).toBeFalse();
  });

  it('needs every group that has values to match', () => {
    expect(matchesFilters(sage, { lifeCycles: ['perennial'], growthForms: ['subshrub'], uses: ['herb'] })).toBeTrue();
    expect(matchesFilters(sage, { lifeCycles: ['perennial'], growthForms: ['shrub'], uses: ['herb'] })).toBeFalse();
  });

  it('leaves out plants without the value when its group is filtered', () => {
    expect(matchesFilters(unknown, { ...NO_FILTERS, lifeCycles: ['perennial'] })).toBeFalse();
    expect(matchesFilters(unknown, { ...NO_FILTERS, growthForms: ['herbaceous'] })).toBeFalse();
    expect(matchesFilters(unknown, { ...NO_FILTERS, uses: ['herb'] })).toBeFalse();
  });
});

describe('hasLifeCycle', () => {
  it('is false only for shrubs and trees', () => {
    expect(hasLifeCycle('shrub')).toBeFalse();
    expect(hasLifeCycle('tree')).toBeFalse();
    for (const form of ['herbaceous', 'subshrub', 'climber', null, undefined] as const) {
      expect(hasLifeCycle(form)).withContext(String(form)).toBeTrue();
    }
  });
});

describe('showsGrowthFormChip', () => {
  it('skips herbaceous plants and unknown forms', () => {
    expect(showsGrowthFormChip('herbaceous')).toBeFalse();
    expect(showsGrowthFormChip(null)).toBeFalse();
    expect(showsGrowthFormChip('subshrub')).toBeTrue();
  });
});

describe('monthRuns', () => {
  it('groups consecutive months, also over the new year', () => {
    expect(monthRuns([5, 6, 7, 8, 9])).toEqual([[5, 9]]);
    expect(monthRuns([4, 5, 6, 9, 10])).toEqual([[4, 6], [9, 10]]);
    expect(monthRuns([1, 2, 12])).toEqual([[12, 2]]);
    expect(monthRuns([7])).toEqual([[7, 7]]);
    expect(monthRuns([])).toEqual([]);
    expect(monthRuns([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toEqual([[1, 12]]);
  });
});

describe('describeMonths', () => {
  const t = (key: string, params?: Record<string, unknown>) =>
    key === 'traits.monthRange' ? `${params!['from']} to ${params!['to']}` : key.replace('months.', 'M');

  it('names each run of months', () => {
    expect(describeMonths([4, 5, 6, 9, 10], t)).toBe('M4 to M6, M9 to M10');
    expect(describeMonths([7], t)).toBe('M7');
  });
});

describe('catalogSeason', () => {
  const seasons = { flowering_months: [6, 7, 8], harvest_months: [7, 8, 9, 10] };

  it('shows the harvest of edible plants', () => {
    for (const use of ['vegetable', 'fruit', 'herb'] as const) {
      expect(catalogSeason({ ...seasons, uses: [use] })).withContext(use).toEqual({ kind: 'harvest', months: [7, 8, 9, 10] });
    }
  });

  it('shows flowering for other plants, and for edible ones without a known harvest', () => {
    expect(catalogSeason({ ...seasons, uses: ['ornamental'] })).toEqual({ kind: 'flowering', months: [6, 7, 8] });
    expect(catalogSeason({ ...seasons, uses: [] })).toEqual({ kind: 'flowering', months: [6, 7, 8] });
    expect(catalogSeason({ flowering_months: [6], harvest_months: [], uses: ['vegetable'] })).toEqual({ kind: 'flowering', months: [6] });
  });
});

describe('toggled', () => {
  it('adds a missing value and removes a present one', () => {
    expect(toggled(['herb'], 'fruit')).toEqual(['herb', 'fruit']);
    expect(toggled(['herb', 'fruit'], 'herb')).toEqual(['fruit']);
  });
});
