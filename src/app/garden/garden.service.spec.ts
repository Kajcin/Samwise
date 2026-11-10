import { CellOccupiedError, GardenService, cellKey } from './garden.service';
import { supabase } from '../core/supabase-client';

function signedInAs(userId: string): void {
  spyOn(supabase.auth, 'getUser').and.resolveTo({ data: { user: { id: userId } }, error: null } as any);
}

describe('cellKey', () => {
  it('produces a stable, unique key per row/col pair', () => {
    expect(cellKey(1, 2)).toBe('1:2');
    expect(cellKey(1, 2)).not.toBe(cellKey(2, 1));
  });
});

describe('GardenService beds', () => {
  let service: GardenService;

  beforeEach(() => {
    service = new GardenService();
  });

  it('listBeds() returns beds ordered by name', async () => {
    const beds = [{ id: 'b1', name: 'Herbs' }];
    const order = jasmine.createSpy('order').and.resolveTo({ data: beds, error: null });
    spyOn(supabase, 'from').and.returnValue({ select: () => ({ order }) } as any);

    expect(await service.listBeds()).toEqual(beds as any);
    expect(supabase.from).toHaveBeenCalledWith('beds');
    expect(order).toHaveBeenCalledWith('name');
  });

  it('createBed() inserts a bed owned by the current user', async () => {
    signedInAs('me');
    const single = jasmine.createSpy('single').and.resolveTo({ data: { id: 'b1' }, error: null });
    const insert = jasmine.createSpy('insert').and.returnValue({ select: () => ({ single }) });
    spyOn(supabase, 'from').and.returnValue({ insert } as any);

    await service.createBed('Herbs', 2, 4);

    expect(insert).toHaveBeenCalledWith({ name: 'Herbs', rows: 2, cols: 4, user_id: 'me' });
  });

  it('getBed() fetches a single bed by id', async () => {
    const single = jasmine.createSpy('single').and.resolveTo({ data: { id: 'b1' }, error: null });
    const eq = jasmine.createSpy('eq').and.returnValue({ single });
    spyOn(supabase, 'from').and.returnValue({ select: () => ({ eq }) } as any);

    expect(await service.getBed('b1')).toEqual({ id: 'b1' } as any);
    expect(eq).toHaveBeenCalledWith('id', 'b1');
  });
});

describe('GardenService plantings', () => {
  let service: GardenService;

  beforeEach(() => {
    service = new GardenService();
  });

  it('listActivePlantings() filters by bed and active status', async () => {
    const rows = [{ id: 'p1' }];
    const statusEq = jasmine.createSpy('statusEq').and.resolveTo({ data: rows, error: null });
    const bedEq = jasmine.createSpy('bedEq').and.returnValue({ eq: statusEq });
    spyOn(supabase, 'from').and.returnValue({ select: () => ({ eq: bedEq }) } as any);

    expect(await service.listActivePlantings('bed-1')).toEqual(rows as any);
    expect(supabase.from).toHaveBeenCalledWith('plantings');
    expect(bedEq).toHaveBeenCalledWith('bed_id', 'bed-1');
    expect(statusEq).toHaveBeenCalledWith('status', 'active');
  });

  it('assignPlanting() inserts a planting row with status active', async () => {
    signedInAs('me');
    const single = jasmine.createSpy('single').and.resolveTo({ data: { id: 'p1' }, error: null });
    const insert = jasmine.createSpy('insert').and.returnValue({ select: () => ({ single }) });
    spyOn(supabase, 'from').and.returnValue({ insert } as any);

    const result = await service.assignPlanting('bed-1', 0, 0, 'plant-1', '2026-04-01');

    expect(insert).toHaveBeenCalledWith(jasmine.objectContaining({
      bed_id: 'bed-1', cell_row: 0, cell_col: 0, plant_id: 'plant-1', planted_date: '2026-04-01', status: 'active', user_id: 'me',
    }));
    expect(result).toEqual({ id: 'p1' } as any);
  });

  it('assignPlanting() turns the one-active-planting-per-cell violation into CellOccupiedError', async () => {
    signedInAs('me');
    const single = jasmine.createSpy('single').and.resolveTo({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "plantings_one_active_per_cell"' },
    });
    spyOn(supabase, 'from').and.returnValue({ insert: () => ({ select: () => ({ single }) }) } as any);

    await expectAsync(service.assignPlanting('bed-1', 1, 2, 'plant-1', '2026-04-01'))
      .toBeRejectedWith(jasmine.any(CellOccupiedError));
  });

  it('assignPlanting() passes other database errors through unchanged', async () => {
    signedInAs('me');
    const dbError = { code: '23503', message: 'insert or update on table "plantings" violates foreign key constraint' };
    const single = jasmine.createSpy('single').and.resolveTo({ data: null, error: dbError });
    spyOn(supabase, 'from').and.returnValue({ insert: () => ({ select: () => ({ single }) }) } as any);

    await expectAsync(service.assignPlanting('bed-1', 1, 2, 'plant-1', '2026-04-01')).toBeRejectedWith(dbError);
  });

  it('removePlanting() marks the planting removed instead of deleting it', async () => {
    const eq = jasmine.createSpy('eq').and.resolveTo({ data: null, error: null });
    const update = jasmine.createSpy('update').and.returnValue({ eq });
    spyOn(supabase, 'from').and.returnValue({ update } as any);

    await service.removePlanting('p1');

    expect(update).toHaveBeenCalledWith({ status: 'removed' });
    expect(eq).toHaveBeenCalledWith('id', 'p1');
  });
});
