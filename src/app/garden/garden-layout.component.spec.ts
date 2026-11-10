import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { buildGrid, GardenLayoutComponent, toIsoDate } from './garden-layout.component';
import { Bed, CellOccupiedError, GardenService, Planting } from './garden.service';
import { Plant, PlantCatalogService } from '../plant-catalog/plant-catalog.service';

const planting = (row: number, col: number, plantId = 'plant-1'): Planting => ({
  id: `${row}-${col}`, user_id: 'me', bed_id: 'bed-1', cell_row: row, cell_col: col,
  plant_id: plantId, planted_date: '2026-04-01', status: 'active',
});

describe('buildGrid', () => {
  it('builds a rows x cols grid of nulls when there are no plantings', () => {
    const grid = buildGrid(2, 3, []);
    expect(grid.length).toBe(2);
    expect(grid[0].length).toBe(3);
    expect(grid[0][0]).toBeNull();
  });

  it('places each active planting at its cell', () => {
    const grid = buildGrid(2, 2, [planting(0, 1), planting(1, 0)]);
    expect(grid[0][1]?.id).toBe('0-1');
    expect(grid[1][0]?.id).toBe('1-0');
    expect(grid[0][0]).toBeNull();
  });
});

describe('toIsoDate', () => {
  it('formats the local calendar date as YYYY-MM-DD', () => {
    expect(toIsoDate(new Date(2026, 3, 5, 23, 30))).toBe('2026-04-05');
    expect(toIsoDate(new Date(2026, 11, 31, 0, 5))).toBe('2026-12-31');
  });
});

describe('GardenLayoutComponent', () => {
  let garden: jasmine.SpyObj<GardenService>;
  let catalog: jasmine.SpyObj<PlantCatalogService>;

  const bed: Bed = { id: 'bed-1', user_id: 'me', name: 'Herbs', rows: 1, cols: 2 };
  const plants = [
    { id: 'plant-1', user_id: null, name: 'Basil' },
    { id: 'plant-2', user_id: null, name: 'Tomato' },
    { id: 'plant-3', user_id: 'me', name: 'Tomato' },
  ] as Plant[];

  async function render() {
    const fixture = TestBed.createComponent(GardenLayoutComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const cells = () => Array.from(el.querySelectorAll<HTMLButtonElement>('td button'));
    const button = (text: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.trim() === text)!;
    return { fixture, el, settle, cells, button };
  }

  beforeEach(() => {
    garden = jasmine.createSpyObj<GardenService>('GardenService', ['listBeds', 'listActivePlantings', 'assignPlanting', 'removePlanting']);
    catalog = jasmine.createSpyObj<PlantCatalogService>('PlantCatalogService', ['list']);
    garden.listBeds.and.resolveTo([bed]);
    garden.listActivePlantings.and.resolveTo([planting(0, 0)]);
    catalog.list.and.resolveTo(plants);
    TestBed.configureTestingModule({
      imports: [GardenLayoutComponent],
      providers: [
        provideRouter([]),
        { provide: GardenService, useValue: garden },
        { provide: PlantCatalogService, useValue: catalog },
      ],
    });
  });

  it('renders each bed as a grid showing plant names', async () => {
    const { el, cells } = await render();

    expect(el.querySelector('h2')!.textContent).toContain('Herbs');
    expect(cells().map((c) => c.textContent!.trim())).toEqual(['Basil', '+']);
  });

  it('assigns a plant to an empty cell and refreshes the bed', async () => {
    garden.assignPlanting.and.resolveTo(planting(0, 1, 'plant-2'));
    const { el, settle, cells, button } = await render();

    cells()[1].click();
    await settle();
    const select = el.querySelector<HTMLSelectElement>('select[name=plant]')!;
    expect(Array.from(select.options).map((o) => o.textContent!.trim())).toEqual(['Choose a plant', 'Basil', 'Tomato', 'Tomato (yours)']);
    select.value = 'plant-2';
    select.dispatchEvent(new Event('change'));
    const date = el.querySelector<HTMLInputElement>('input[name=planted]')!;
    date.value = '2026-04-10';
    date.dispatchEvent(new Event('input'));
    garden.listActivePlantings.and.resolveTo([planting(0, 0), planting(0, 1, 'plant-2')]);
    button('Plant').click();
    await settle();

    expect(garden.assignPlanting).toHaveBeenCalledWith('bed-1', 0, 1, 'plant-2', '2026-04-10');
    expect(cells().map((c) => c.textContent!.trim())).toEqual(['Basil', 'Tomato']);
    expect(el.querySelector('select[name=plant]')).toBeNull();
  });

  it('requires a plant before assigning', async () => {
    const { el, settle, cells, button } = await render();

    cells()[1].click();
    await settle();
    button('Plant').click();
    await settle();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('Choose a plant.');
    expect(garden.assignPlanting).not.toHaveBeenCalled();
  });

  it('removes the planting from an occupied cell', async () => {
    garden.removePlanting.and.resolveTo();
    const { el, settle, cells, button } = await render();

    cells()[0].click();
    await settle();
    expect(el.textContent).toContain('Planted 2026-04-01');
    garden.listActivePlantings.and.resolveTo([]);
    button('Remove').click();
    await settle();

    expect(garden.removePlanting).toHaveBeenCalledWith('0-0');
    expect(cells().map((c) => c.textContent!.trim())).toEqual(['+', '+']);
  });

  it('explains when the cell was taken in the meantime', async () => {
    garden.assignPlanting.and.rejectWith(new CellOccupiedError(0, 1));
    const { el, settle, cells, button } = await render();

    cells()[1].click();
    await settle();
    const select = el.querySelector<HTMLSelectElement>('select[name=plant]')!;
    select.value = 'plant-1';
    select.dispatchEvent(new Event('change'));
    button('Plant').click();
    await settle();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('That cell already has a plant.');
  });

  it('points to the bed editor when there are no beds yet', async () => {
    garden.listBeds.and.resolveTo([]);
    const { el } = await render();

    expect(el.textContent).toContain('No beds yet');
    expect(el.querySelector('a[href="/garden/new"]')).not.toBeNull();
  });
});
