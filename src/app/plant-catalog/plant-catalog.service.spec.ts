import { PlantCatalogService } from './plant-catalog.service';
import { supabase } from '../core/supabase-client';

function signedInAs(userId: string): void {
  spyOn(supabase.auth, 'getUser').and.resolveTo({ data: { user: { id: userId } }, error: null } as any);
}

describe('PlantCatalogService', () => {
  let service: PlantCatalogService;

  beforeEach(() => {
    service = new PlantCatalogService();
  });

  it('list() returns rows from plants_catalog ordered by name', async () => {
    const rows = [{ id: '1', name: 'Basil' }, { id: '2', name: 'Tomato' }];
    const order = jasmine.createSpy('order').and.resolveTo({ data: rows, error: null });
    const select = jasmine.createSpy('select').and.returnValue({ order });
    spyOn(supabase, 'from').and.returnValue({ select } as any);

    const result = await service.list();

    expect(supabase.from).toHaveBeenCalledWith('plants_catalog');
    expect(order).toHaveBeenCalledWith('name');
    expect(result).toEqual(rows as any);
  });

  it('list() throws when Supabase returns an error', async () => {
    const order = jasmine.createSpy('order').and.resolveTo({ data: null, error: new Error('boom') });
    spyOn(supabase, 'from').and.returnValue({ select: () => ({ order }) } as any);

    await expectAsync(service.list()).toBeRejectedWithError('boom');
  });

  it('get() fetches a single plant by id', async () => {
    const plant = { id: 'p1', name: 'Basil' };
    const single = jasmine.createSpy('single').and.resolveTo({ data: plant, error: null });
    const eq = jasmine.createSpy('eq').and.returnValue({ single });
    spyOn(supabase, 'from').and.returnValue({ select: () => ({ eq }) } as any);

    expect(await service.get('p1')).toEqual(plant as any);
    expect(eq).toHaveBeenCalledWith('id', 'p1');
  });

  it('addCustom() inserts the plant owned by the current user', async () => {
    signedInAs('me');
    const created = { id: 'new-1', user_id: 'me', name: 'Kale' };
    const single = jasmine.createSpy('single').and.resolveTo({ data: created, error: null });
    const insert = jasmine.createSpy('insert').and.returnValue({ select: () => ({ single }) });
    spyOn(supabase, 'from').and.returnValue({ insert } as any);

    const result = await service.addCustom({
      name: 'Kale', species: null, sun_requirements: 'partial_shade', watering_frequency_days: 3,
      flowering_start_month: null, flowering_end_month: null, notes: null,
    });

    expect(insert).toHaveBeenCalledWith(jasmine.objectContaining({ name: 'Kale', user_id: 'me' }));
    expect(result).toEqual(created as any);
  });

  it("cloneToCustom() copies a seeded plant's fields and rules under the current user", async () => {
    signedInAs('me');
    const seeded = {
      id: 'seed-1', user_id: null, name: 'Tomato', species: 'Solanum lycopersicum', sun_requirements: 'full_sun',
      watering_frequency_days: 2, flowering_start_month: 6, flowering_end_month: 9, notes: null,
    };
    const seededRules = [
      { task_type: 'harvest', timing_type: 'offset_from_planting', offset_days: 75, recurrence_days: null, notes: null },
    ];
    const cloned = { ...seeded, id: 'clone-1', user_id: 'me' };

    const sourceSingle = jasmine.createSpy('sourceSingle').and.resolveTo({ data: seeded, error: null });
    const cloneSingle = jasmine.createSpy('cloneSingle').and.resolveTo({ data: cloned, error: null });
    const insertPlant = jasmine.createSpy('insertPlant').and.returnValue({ select: () => ({ single: cloneSingle }) });
    const rulesEq = jasmine.createSpy('rulesEq').and.resolveTo({ data: seededRules, error: null });
    const insertRules = jasmine.createSpy('insertRules').and.resolveTo({ data: null, error: null });

    spyOn(supabase, 'from').and.callFake(((table: string) => {
      if (table === 'plants_catalog') {
        return { select: () => ({ eq: () => ({ single: sourceSingle }) }), insert: insertPlant };
      }
      if (table === 'care_rules') {
        return { select: () => ({ eq: rulesEq }), insert: insertRules };
      }
      throw new Error('unexpected table ' + table);
    }) as any);

    const result = await service.cloneToCustom('seed-1');

    expect(result).toEqual(cloned as any);
    const insertedPlant = insertPlant.calls.mostRecent().args[0];
    expect(insertedPlant.user_id).toBe('me');
    expect(insertedPlant.name).toBe('Tomato');
    expect('id' in insertedPlant).toBeFalse();
    expect(rulesEq).toHaveBeenCalledWith('plant_id', 'seed-1');
    expect(insertRules).toHaveBeenCalledWith([jasmine.objectContaining({ plant_id: 'clone-1', task_type: 'harvest', offset_days: 75 })]);
  });
});

describe('PlantCatalogService care rules', () => {
  let service: PlantCatalogService;

  beforeEach(() => {
    service = new PlantCatalogService();
  });

  it('listCareRules() returns rules for a plant', async () => {
    const rules = [{ id: 'r1', plant_id: 'p1', task_type: 'harvest', timing_type: 'offset_from_planting', offset_days: 40, recurrence_days: null, notes: null }];
    const eq = jasmine.createSpy('eq').and.resolveTo({ data: rules, error: null });
    spyOn(supabase, 'from').and.returnValue({ select: () => ({ eq }) } as any);

    expect(await service.listCareRules('p1')).toEqual(rules as any);
    expect(eq).toHaveBeenCalledWith('plant_id', 'p1');
  });

  it('addCareRule() inserts a rule scoped to the given plant', async () => {
    const single = jasmine.createSpy('single').and.resolveTo({ data: { id: 'r2' }, error: null });
    const insert = jasmine.createSpy('insert').and.returnValue({ select: () => ({ single }) });
    spyOn(supabase, 'from').and.returnValue({ insert } as any);

    await service.addCareRule('p1', { task_type: 'prune', timing_type: 'recurring', offset_days: null, recurrence_days: 14, notes: null });

    expect(insert).toHaveBeenCalledWith(jasmine.objectContaining({ plant_id: 'p1', task_type: 'prune' }));
  });

  it('updateCareRule() patches only the given rule row', async () => {
    const eq = jasmine.createSpy('eq').and.resolveTo({ data: null, error: null });
    const update = jasmine.createSpy('update').and.returnValue({ eq });
    spyOn(supabase, 'from').and.returnValue({ update } as any);

    await service.updateCareRule('r1', { recurrence_days: 21 });

    expect(update).toHaveBeenCalledWith({ recurrence_days: 21 });
    expect(eq).toHaveBeenCalledWith('id', 'r1');
  });
});
