import type { Plant } from './plant-catalog.service';
import { floweringIn, hasLifeCycle, matchesFilters, NO_FILTERS, showsGrowthFormChip, toggled } from './traits';

function plant(overrides: Partial<Plant>): Plant {
  return {
    id: 'x', user_id: 'me', name: 'X', species: null, sun_requirements: 'full_sun', watering_frequency_days: null,
    flowering_start_month: null, flowering_end_month: null, notes: null, ...overrides,
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

describe('floweringIn', () => {
  it('covers the months of the range, also over the new year', () => {
    const months = (start: number, end: number) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => floweringIn(m, start, end));
    expect(months(5, 9)).toEqual([5, 6, 7, 8, 9]);
    expect(months(11, 2)).toEqual([1, 2, 11, 12]);
    expect(months(7, 7)).toEqual([7]);
    expect(floweringIn(5, null, null)).toBeFalse();
  });
});

describe('toggled', () => {
  it('adds a missing value and removes a present one', () => {
    expect(toggled(['herb'], 'fruit')).toEqual(['herb', 'fruit']);
    expect(toggled(['herb', 'fruit'], 'herb')).toEqual(['fruit']);
  });
});
