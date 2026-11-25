import { PlantInGardenError } from './plant-catalog.service';
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
      notes: null,
    });

    expect(insert).toHaveBeenCalledWith(jasmine.objectContaining({ name: 'Kale', user_id: 'me' }));
    expect(result).toEqual(created as any);
  });

  it("cloneToCustom() copies a seeded plant's fields and rules under the current user", async () => {
    signedInAs('me');
    const seeded = {
      id: 'seed-1', user_id: null, name: 'Tomato', species: 'Solanum lycopersicum', sun_requirements: 'full_sun',
      watering_frequency_days: 2, flowering_months: [6, 7, 8], harvest_months: [7, 8, 9, 10], notes: null,
    };
    const seededRules = [
      { task_type: 'harvest', timing_type: 'offset_from_planting', offset_days: 75, recurrence_days: null, notes: null },
      { task_type: 'harvest', timing_type: 'recurring', offset_days: null, recurrence_days: 7, months: [], season: 'harvest', notes: null },
    ];
    const cloned = { ...seeded, id: 'clone-1', user_id: 'me' };

    const sourceSingle = jasmine.createSpy('sourceSingle').and.resolveTo({ data: seeded, error: null });
    const cloneSingle = jasmine.createSpy('cloneSingle').and.resolveTo({ data: cloned, error: null });
    const insertPlant = jasmine.createSpy('insertPlant').and.returnValue({ select: () => ({ single: cloneSingle }) });
    const rulesEq = jasmine.createSpy('rulesEq').and.resolveTo({ data: seededRules, error: null });
    const insertRules = jasmine.createSpy('insertRules').and.resolveTo({ data: null, error: null });
    const selectRules = jasmine.createSpy('selectRules').and.returnValue({ eq: rulesEq });

    spyOn(supabase, 'from').and.callFake(((table: string) => {
      if (table === 'plants_catalog') {
        return { select: () => ({ eq: () => ({ single: sourceSingle }) }), insert: insertPlant };
      }
      if (table === 'care_rules') {
        return { select: selectRules, insert: insertRules };
      }
      throw new Error('unexpected table ' + table);
    }) as any);

    const result = await service.cloneToCustom('seed-1');

    expect(result).toEqual(cloned as any);
    const insertedPlant = insertPlant.calls.mostRecent().args[0];
    expect(insertedPlant.user_id).toBe('me');
    expect(insertedPlant.name).toBe('Tomato');
    expect(insertedPlant.flowering_months).toEqual([6, 7, 8]);
    expect(insertedPlant.harvest_months).toEqual([7, 8, 9, 10]);
    expect('id' in insertedPlant).toBeFalse();
    expect(rulesEq).toHaveBeenCalledWith('plant_id', 'seed-1');
    // Every timing field comes along: yearly months, and the months a repeating rule keeps to.
    expect(selectRules.calls.mostRecent().args[0].split(',')).toEqual(
      jasmine.arrayContaining(['month', 'month_part', 'months', 'season']),
    );
    expect(insertRules).toHaveBeenCalledWith([
      jasmine.objectContaining({ plant_id: 'clone-1', task_type: 'harvest', offset_days: 75 }),
      jasmine.objectContaining({ plant_id: 'clone-1', recurrence_days: 7, season: 'harvest' }),
    ]);
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

describe('PlantCatalogService editing', () => {
  let service: PlantCatalogService;

  beforeEach(() => {
    service = new PlantCatalogService();
  });

  it('updatePlant() updates the plant and returns the saved row', async () => {
    const saved = { id: 'p2', name: 'Catmint' };
    const single = jasmine.createSpy('single').and.resolveTo({ data: saved, error: null });
    const eq = jasmine.createSpy('eq').and.returnValue({ select: () => ({ single }) });
    const update = jasmine.createSpy('update').and.returnValue({ eq });
    spyOn(supabase, 'from').and.returnValue({ update } as any);

    expect(await service.updatePlant('p2', { name: 'Catmint', source_url: 'https://x.cz' })).toEqual(saved as any);
    expect(update).toHaveBeenCalledWith({ name: 'Catmint', source_url: 'https://x.cz' });
    expect(eq).toHaveBeenCalledWith('id', 'p2');
  });

  /** delete_plant answers `deleted`; plant_photos lists `paths` as uploads. */
  function fakeDelete(deleted: { data: null; error: unknown }, paths: string[] = []) {
    const rpc = spyOn(supabase, 'rpc').and.resolveTo(deleted as any);
    const photos = { select: () => ({ eq: () => ({ not: () => Promise.resolve({ data: paths.map((storage_path) => ({ storage_path })), error: null }) }) }) };
    spyOn(supabase, 'from').and.returnValue(photos as any);
    const remove = jasmine.createSpy('remove').and.resolveTo({ data: [], error: null });
    spyOn(supabase.storage, 'from').and.returnValue({ remove } as any);
    return { rpc, remove };
  }

  it('deletePlant() deletes the plant through delete_plant, and the files of its uploaded photos', async () => {
    const { rpc, remove } = fakeDelete({ data: null, error: null }, ['me/p2/a.jpg', 'me/p2/b.jpg']);

    await service.deletePlant('p2');

    expect(rpc).toHaveBeenCalledWith('delete_plant', { p_plant_id: 'p2' });
    expect(remove).toHaveBeenCalledWith(['me/p2/a.jpg', 'me/p2/b.jpg']);
  });

  it('deletePlant() reports a plant that is in a bed, with the beds, keeping its photos', async () => {
    const { remove } = fakeDelete(
      { data: null, error: { code: 'P0001', message: 'plant_in_garden', details: 'Herbs, Veg' } },
      ['me/p2/a.jpg'],
    );

    const error = await service.deletePlant('p2').catch((e) => e);

    expect(error).toEqual(jasmine.any(PlantInGardenError));
    expect((error as PlantInGardenError).beds).toEqual(['Herbs', 'Veg']);
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletionCheck() says which beds the plant is in and what history would go', async () => {
    const single = jasmine.createSpy('single').and.resolveTo({ data: { active_beds: ['Herbs'], completed_tasks: 2 }, error: null });
    const rpc = spyOn(supabase, 'rpc').and.returnValue({ single } as any);

    expect(await service.deletionCheck('p2')).toEqual({ activeBeds: ['Herbs'], completedTasks: 2 });
    expect(rpc).toHaveBeenCalledWith('plant_deletion_check', { p_plant_id: 'p2' });
  });

  it('deleteCareRule() deletes the rule', async () => {
    const eq = jasmine.createSpy('eq').and.resolveTo({ data: null, error: null });
    spyOn(supabase, 'from').and.returnValue({ delete: () => ({ eq }) } as any);

    await service.deleteCareRule('r1');
    expect(eq).toHaveBeenCalledWith('id', 'r1');
  });

  it('cloneToCustom() in Czech copies the Czech texts as the copy’s own', async () => {
    spyOn(supabase.auth, 'getUser').and.resolveTo({ data: { user: { id: 'me' } }, error: null } as any);
    const seeded = {
      id: 'seed-1', user_id: null, name: 'Tomato', name_cs: 'Rajče', species: null, sun_requirements: 'full_sun',
      watering_frequency_days: 2, flowering_months: [6, 7, 8], harvest_months: [7, 8, 9, 10],
      notes: 'Stake it.', notes_cs: 'Vyvazujte.', source_url: null,
    };
    const rules = [{ task_type: 'transplant', timing_type: 'offset_from_planting', offset_days: 21, recurrence_days: null,
      notes: 'After last frost.', notes_cs: 'Po posledních mrazech.' }];
    const insertPlant = jasmine.createSpy('insertPlant').and.returnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'clone-1' }, error: null }) }),
    });
    const insertRules = jasmine.createSpy('insertRules').and.resolveTo({ data: null, error: null });
    spyOn(supabase, 'from').and.callFake(((table: string) =>
      table === 'plants_catalog'
        ? { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: seeded, error: null }) }) }), insert: insertPlant }
        : { select: () => ({ eq: () => Promise.resolve({ data: rules, error: null }) }), insert: insertRules }) as any);

    await service.cloneToCustom('seed-1', 'cs');

    const plant = insertPlant.calls.mostRecent().args[0];
    expect([plant.name, plant.notes, 'name_cs' in plant, 'notes_cs' in plant]).toEqual(['Rajče', 'Vyvazujte.', false, false]);
    const [rule] = insertRules.calls.mostRecent().args[0];
    expect([rule.notes, 'notes_cs' in rule]).toEqual(['Po posledních mrazech.', false]);
  });
});
