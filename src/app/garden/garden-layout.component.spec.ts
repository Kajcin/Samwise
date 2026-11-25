import { provideI18n } from '../core/i18n/i18n';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { buildEditGrid, buildGrid, editErrorMessage, GAP, GardenLayoutComponent } from './garden-layout.component';
import { msg } from '../core/i18n/i18n';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';
import { Bed, BedEditError, CellOccupiedError, GardenService, Planting } from './garden.service';
import { Plant, PlantCatalogService } from '../plant-catalog/plant-catalog.service';
import { PlantPhoto, PlantPhotosService } from '../plant-catalog/plant-photos.service';

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
    expect((grid[0][1] as Planting).id).toBe('0-1');
    expect((grid[1][0] as Planting).id).toBe('1-0');
    expect(grid[0][0]).toBeNull();
  });

  it('marks the gaps of a bed that isn’t a full rectangle', () => {
    const grid = buildGrid(2, 2, [planting(0, 0)], [[1, 1]]);
    expect(grid[1][1]).toBe(GAP);
    expect(grid[1][0]).toBeNull();
  });
});

describe('buildEditGrid', () => {
  const kinds = (grid: ReturnType<typeof buildEditGrid>) => grid.map((row) => row.map((c) => c.kind[0]).join(''));

  it('offers a slot in each gap and next to each edge slot, never in the corners', () => {
    // An L: slots at (0,0), (1,0), (1,1); (0,1) is a gap. The edit grid adds a ring around
    // the box (s = slot, a = "+", n = nothing): above the gap and right of it touch no slot.
    const grid = buildEditGrid({ rows: 2, cols: 2 }, buildGrid(2, 2, [], [[0, 1]]), 20);
    expect(kinds(grid)).toEqual(['nann', 'asan', 'assa', 'naan']);
  });

  it('stops at the size limit', () => {
    const grid = buildEditGrid({ rows: 1, cols: 2 }, buildGrid(1, 2, []), 2);
    expect(kinds(grid)).toEqual(['naan', 'nssn', 'naan']);
  });
});

describe('editErrorMessage', () => {
  it('explains what the database refused', () => {
    expect(editErrorMessage(new BedEditError('slot_last'))).toEqual(msg('garden.errors.lastSlot'));
    expect(editErrorMessage(new BedEditError('bed_too_large'))).toEqual(msg('garden.errors.tooLarge', { max: 20 }));
    expect(editErrorMessage(new BedEditError('bed_not_empty'))).toEqual(msg('garden.errors.bedNotEmpty'));
    expect(editErrorMessage(new Error('offline'))).toEqual(msg('garden.errors.edit', { detail: 'offline' }));
  });
});

describe('GardenLayoutComponent', () => {
  let garden: jasmine.SpyObj<GardenService>;
  let catalog: jasmine.SpyObj<PlantCatalogService>;
  let photos: jasmine.SpyObj<PlantPhotosService>;
  let dialog: jasmine.SpyObj<ConfirmDialogService>;

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
    garden = jasmine.createSpyObj<GardenService>('GardenService', [
      'listBeds', 'listActivePlantings', 'assignPlanting', 'removePlanting', 'createBed',
      'addSlot', 'removeSlot', 'renameBed', 'deleteBed',
    ]);
    dialog = jasmine.createSpyObj<ConfirmDialogService>('ConfirmDialogService', ['ask']);
    dialog.ask.and.resolveTo(true);
    catalog = jasmine.createSpyObj<PlantCatalogService>('PlantCatalogService', ['list']);
    garden.listBeds.and.resolveTo([bed]);
    garden.listActivePlantings.and.resolveTo([planting(0, 0)]);
    catalog.list.and.resolveTo(plants);
    photos = jasmine.createSpyObj<PlantPhotosService>('PlantPhotosService', ['mainPhotos']);
    photos.mainPhotos.and.resolveTo(new Map());
    TestBed.configureTestingModule({
      imports: [GardenLayoutComponent],
      providers: [provideI18n(), 
        provideRouter([]),
        { provide: GardenService, useValue: garden },
        { provide: PlantCatalogService, useValue: catalog },
        { provide: PlantPhotosService, useValue: photos },
        { provide: ConfirmDialogService, useValue: dialog },
      ],
    });
  });

  describe('editing a bed', () => {
    const editButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button.edit-bed')!;
    const addButtons = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('button.add-slot'));
    const slotButtons = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('button.remove-slot'));
    const byLabel = (buttons: HTMLButtonElement[], label: string) => buttons.find((b) => b.getAttribute('aria-label') === label)!;

    it('switches the card to editing: the name, a "+" around and inside the bed, removable slots', async () => {
      const { el, settle } = await render();
      expect(el.querySelector('h2')!.textContent).toContain('(2 cells)');

      editButton(el).click();
      await settle();

      expect(el.querySelector<HTMLInputElement>('input[name=bedName]')!.value).toBe('Herbs');
      expect(el.textContent).toContain('Click + to add a cell, or click a cell to remove it.');
      expect(slotButtons(el).map((b) => b.getAttribute('aria-label'))).toEqual([
        'Remove the cell at row 1, column 1: Basil',
        'Remove the cell at row 1, column 2: empty',
      ]);
      // Above and below each slot, and at both ends of the row: 6.
      expect(addButtons(el).length).toBe(6);
      expect(el.querySelector('select[name=plant]')).toBeNull();
    });

    it('adds a slot with "+", and redraws the bed', async () => {
      garden.addSlot.and.resolveTo({ ...bed, cols: 3 });
      const { el, settle } = await render();
      editButton(el).click();
      await settle();

      byLabel(addButtons(el), 'Add a cell at row 1, column 3').click();
      await settle();

      expect(garden.addSlot).toHaveBeenCalledWith('bed-1', 0, 2);
      expect(slotButtons(el).length).toBe(3);
    });

    it('removes an empty slot straight away, and asks first when a plant grows in it', async () => {
      garden.removeSlot.and.resolveTo({ ...bed, cols: 1 });
      const { el, settle } = await render();
      editButton(el).click();
      await settle();

      dialog.ask.and.resolveTo(false);
      byLabel(slotButtons(el), 'Remove the cell at row 1, column 1: Basil').click();
      await settle();
      expect(dialog.ask.calls.mostRecent().args[0].message).toContain('Basil grows in this cell.');
      expect(garden.removeSlot).not.toHaveBeenCalled(); // cancelled

      dialog.ask.calls.reset();
      byLabel(slotButtons(el), 'Remove the cell at row 1, column 2: empty').click();
      await settle();
      expect(dialog.ask).not.toHaveBeenCalled();
      expect(garden.removeSlot).toHaveBeenCalledWith('bed-1', 0, 1);
    });

    it('doesn’t offer to remove the last slot', async () => {
      garden.listBeds.and.resolveTo([{ ...bed, cols: 1 }]);
      const { el, settle } = await render();
      editButton(el).click();
      await settle();

      expect(slotButtons(el)[0].disabled).toBeTrue();
      expect(slotButtons(el)[0].title).toContain('The last cell can’t be removed.');
    });

    it('saves a new name when done, and needs one', async () => {
      garden.renameBed.and.resolveTo({ ...bed, name: 'Kitchen herbs' });
      const { el, settle, button } = await render();
      editButton(el).click();
      await settle();
      const name = el.querySelector<HTMLInputElement>('input[name=bedName]')!;

      name.value = '  ';
      name.dispatchEvent(new Event('input'));
      button('Done').click();
      await settle();
      expect(el.querySelector('.edit-error')!.textContent).toContain('Name is required.');

      name.value = 'Kitchen herbs';
      name.dispatchEvent(new Event('input'));
      button('Done').click();
      await settle();
      expect(garden.renameBed).toHaveBeenCalledWith('bed-1', 'Kitchen herbs');
      expect(el.querySelector('h2')!.textContent).toContain('Kitchen herbs');
      expect(el.querySelector('input[name=bedName]')).toBeNull();
    });

    it('won’t delete a bed something grows in', async () => {
      const { el, settle } = await render();
      editButton(el).click();
      await settle();

      el.querySelector<HTMLButtonElement>('button.delete-bed')!.click();
      await settle();

      expect(dialog.ask).not.toHaveBeenCalled();
      expect(garden.deleteBed).not.toHaveBeenCalled();
      expect(el.querySelector('.edit-error')!.textContent).toContain('can’t be deleted while something grows in it');
    });

    it('deletes an empty bed after confirmation', async () => {
      garden.deleteBed.and.resolveTo();
      garden.listActivePlantings.and.resolveTo([]);
      const { el, settle } = await render();
      editButton(el).click();
      await settle();

      el.querySelector<HTMLButtonElement>('button.delete-bed')!.click();
      await settle();

      expect(dialog.ask.calls.mostRecent().args[0].message).toBe('“Herbs” will be deleted.');
      expect(garden.deleteBed).toHaveBeenCalledWith('bed-1');
      expect(el.querySelector('section.card')).toBeNull();
    });

    it('says why when the database refuses', async () => {
      garden.addSlot.and.rejectWith(new BedEditError('bed_too_large'));
      const { el, settle } = await render();
      editButton(el).click();
      await settle();

      addButtons(el)[0].click();
      await settle();

      expect(el.querySelector('.edit-error')!.textContent).toContain('A bed can be at most 20 rows by 20 columns.');
    });

    it('shows a gap as empty space outside edit mode', async () => {
      garden.listBeds.and.resolveTo([{ ...bed, rows: 2, gaps: [[1, 1]] }]);
      const { el, cells } = await render();

      expect(cells().length).toBe(3);
      expect(el.querySelectorAll('.cell-spacer').length).toBe(1);
      expect(el.querySelector('h2')!.textContent).toContain('(3 cells)');
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

  it('offers to create the first bed when there are none yet', async () => {
    garden.listBeds.and.resolveTo([]);
    const { el, fixture } = await render();

    expect(el.textContent).toContain('No beds yet');
    el.querySelector<HTMLButtonElement>('button.first-bed')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[role=dialog] .modal-title')!.textContent).toContain('New bed');
  });

  it('creates a bed in the dialog from the top of the page, and shows it', async () => {
    const created: Bed = { id: 'bed-2', user_id: 'me', name: 'Annuals', rows: 2, cols: 3 };
    garden.createBed.and.resolveTo(created);
    const { el, settle } = await render();
    el.querySelector<HTMLButtonElement>('button.new-bed')!.click();
    await settle();

    const dialog = el.querySelector('[role=dialog]')!;
    expect(Array.from(dialog.querySelectorAll('.modal-footer button')).map((b) => b.textContent!.trim()))
      .toEqual(['Close', 'Save bed']);
    const set = (name: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('name', 'Annuals');
    set('rows', '2');
    el.querySelector<HTMLFormElement>('form.bed-form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(garden.createBed).toHaveBeenCalledWith('Annuals', 2, 3);
    expect(el.querySelector('[role=dialog]')).toBeNull();
    expect(Array.from(el.querySelectorAll('h2')).map((h) => h.textContent!.trim().split(' ')[0])).toEqual(['Annuals', 'Herbs']);
  });

  it('keeps the dialog open with a message for an invalid bed', async () => {
    const { el, settle } = await render();
    el.querySelector<HTMLButtonElement>('button.new-bed')!.click();
    await settle();

    el.querySelector<HTMLFormElement>('form.bed-form')!.dispatchEvent(new Event('submit')); // no name
    await settle();

    expect(garden.createBed).not.toHaveBeenCalled();
    expect(el.querySelector('form.bed-form [role=alert]')!.textContent).toContain('Name is required.');
  });

  it('opens the dialog when asked to in the address (/garden?newBed=1)', async () => {
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { queryParamMap: convertToParamMap({ newBed: '1' }) } } });
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const { el } = await render();

    expect(el.querySelector('[role=dialog] .modal-title')!.textContent).toContain('New bed');
    expect(navigate).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: {}, replaceUrl: true })); // cleaned
  });

  it('shows the plant’s main photo in its cells, with the name over it', async () => {
    photos.mainPhotos.and.resolveTo(new Map([['plant-1', { plant_id: 'plant-1', displayUrl: 'https://storage.test/basil.jpg' } as PlantPhoto]]));
    const { settle, cells } = await render();
    await settle();

    const [basil, empty] = cells();
    expect(basil.classList).toContain('with-photo');
    expect(basil.querySelector('img')!.getAttribute('src')).toBe('https://storage.test/basil.jpg');
    expect(basil.textContent!.trim()).toBe('Basil'); // the name stays, over the photo
    expect(empty.querySelector('img')).toBeNull();

    basil.querySelector('img')!.dispatchEvent(new Event('error')); // a link that's gone
    await settle();
    expect(cells()[0].classList).not.toContain('with-photo');
    expect(cells()[0].textContent!.trim()).toBe('Basil');
  });

  it('still shows the garden when the photos can’t be loaded', async () => {
    photos.mainPhotos.and.rejectWith(new Error('offline'));
    spyOn(console, 'error');
    const { settle, cells } = await render();
    await settle();

    expect(cells().map((c) => c.textContent!.trim())).toEqual(['Basil', '+']);
  });
});
