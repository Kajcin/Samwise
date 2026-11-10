import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { filterPlants, PlantCatalogListComponent, validateNewPlantForm } from './plant-catalog-list.component';
import { Plant, PlantCatalogService } from './plant-catalog.service';

function plant(overrides: Partial<Plant>): Plant {
  return {
    id: 'x', user_id: null, name: 'X', species: null, sun_requirements: 'full_sun', watering_frequency_days: 2,
    flowering_start_month: null, flowering_end_month: null, notes: null, ...overrides,
  };
}

const plants: Plant[] = [
  plant({ id: '1', name: 'Tomato' }),
  plant({ id: '2', name: 'Basil' }),
  plant({ id: '3', user_id: 'me', name: 'My Chili', watering_frequency_days: 3 }),
];

describe('filterPlants', () => {
  it('returns all plants when query is empty', () => {
    expect(filterPlants(plants, '')).toEqual(plants);
  });

  it('matches by case-insensitive substring of name', () => {
    expect(filterPlants(plants, 'bas').map((p) => p.name)).toEqual(['Basil']);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(filterPlants(plants, '  CHILI ').map((p) => p.name)).toEqual(['My Chili']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterPlants(plants, 'zzz')).toEqual([]);
  });
});

describe('validateNewPlantForm', () => {
  it('requires a name', () => {
    expect(validateNewPlantForm('  ', 'full_sun')).toBe('Name is required.');
  });

  it('requires a sun requirement', () => {
    expect(validateNewPlantForm('Kale', null)).toBe('Sun requirement is required.');
  });

  it('accepts a valid form', () => {
    expect(validateNewPlantForm('Kale', 'full_sun')).toBeNull();
  });
});

describe('PlantCatalogListComponent', () => {
  let service: jasmine.SpyObj<PlantCatalogService>;

  async function render() {
    const fixture = TestBed.createComponent(PlantCatalogListComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    service = jasmine.createSpyObj<PlantCatalogService>('PlantCatalogService', ['list', 'addCustom', 'cloneToCustom']);
    service.list.and.resolveTo(plants);
    TestBed.configureTestingModule({
      imports: [PlantCatalogListComponent],
      providers: [provideRouter([]), { provide: PlantCatalogService, useValue: service }],
    });
  });

  it('lists plants by name and offers cloning only for built-in plants', async () => {
    const { el } = await render();
    const items = Array.from(el.querySelectorAll('li'));

    expect(items.map((li) => li.querySelector('a')!.textContent!.trim())).toEqual(['Basil', 'My Chili', 'Tomato']);
    const clonable = items.filter((li) => li.querySelector('button')).map((li) => li.querySelector('a')!.textContent!.trim());
    expect(clonable).toEqual(['Basil', 'Tomato']);
  });

  it('filters the list as the user types', async () => {
    const { fixture, el } = await render();
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    search.value = 'tom';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(Array.from(el.querySelectorAll('li a')).map((a) => a.textContent!.trim())).toEqual(['Tomato']);
  });

  it('shows a validation error instead of saving a plant without a sun requirement', async () => {
    const { fixture, el } = await render();
    const name = el.querySelector<HTMLInputElement>('input[name=name]')!;
    name.value = 'Kale';
    name.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('Sun requirement is required.');
    expect(service.addCustom).not.toHaveBeenCalled();
  });

  it('saves a valid custom plant and opens it', async () => {
    const created = plant({ id: 'new-1', user_id: 'me', name: 'Kale', sun_requirements: 'partial_shade' });
    service.addCustom.and.resolveTo(created);
    const { fixture, el } = await render();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

    const name = el.querySelector<HTMLInputElement>('input[name=name]')!;
    name.value = 'Kale';
    name.dispatchEvent(new Event('input'));
    const sun = el.querySelector<HTMLSelectElement>('select[name=sun]')!;
    sun.value = 'partial_shade';
    sun.dispatchEvent(new Event('change'));
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(service.addCustom).toHaveBeenCalledWith(jasmine.objectContaining({ name: 'Kale', sun_requirements: 'partial_shade' }));
    expect(navigate).toHaveBeenCalledWith(['/plants', 'new-1']);
  });

  it('shows an error when the catalog fails to load', async () => {
    service.list.and.rejectWith(new Error('offline'));
    const { el } = await render();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('offline');
  });
});
