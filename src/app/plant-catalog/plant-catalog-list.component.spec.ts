import { provideI18n } from '../core/i18n/i18n';
import { msg } from '../core/i18n/i18n';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';
import { PlantInUseError } from './plant-catalog.service';
import { PlantCandidate, PlantLookupService } from './plant-lookup.service';
import { FunctionError } from '../core/edge-functions';
import { PlantPhotosService } from './plant-photos.service';
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
    expect(validateNewPlantForm('  ', 'full_sun')).toEqual(msg('catalog.errors.nameRequired'));
  });

  it('requires a sun requirement', () => {
    expect(validateNewPlantForm('Kale', null)).toEqual(msg('catalog.errors.sunRequired'));
  });

  it('accepts a valid form', () => {
    expect(validateNewPlantForm('Kale', 'full_sun')).toBeNull();
  });
});

describe('PlantCatalogListComponent', () => {
  let service: jasmine.SpyObj<PlantCatalogService>;
  let dialog: jasmine.SpyObj<ConfirmDialogService>;
  let lookup: jasmine.SpyObj<PlantLookupService>;
  let photos: jasmine.SpyObj<PlantPhotosService>;

  async function render() {
    const fixture = TestBed.createComponent(PlantCatalogListComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    service = jasmine.createSpyObj<PlantCatalogService>('PlantCatalogService', ['list', 'addCustom', 'cloneToCustom', 'deletePlant']);
    service.list.and.resolveTo(plants);
    dialog = jasmine.createSpyObj<ConfirmDialogService>('ConfirmDialogService', ['ask']);
    dialog.ask.and.resolveTo(true);
    lookup = jasmine.createSpyObj<PlantLookupService>('PlantLookupService', ['lookup']);
    photos = jasmine.createSpyObj<PlantPhotosService>('PlantPhotosService', ['addWikimedia', 'mainPhotos']);
    photos.addWikimedia.and.resolveTo();
    photos.mainPhotos.and.resolveTo(new Map());
    TestBed.configureTestingModule({
      imports: [PlantCatalogListComponent],
      providers: [
        provideI18n(),
        provideRouter([]),
        { provide: PlantCatalogService, useValue: service },
        { provide: ConfirmDialogService, useValue: dialog },
        { provide: PlantLookupService, useValue: lookup },
        { provide: PlantPhotosService, useValue: photos },
      ],
    });
  });

  it('lists plants by name and offers cloning only for built-in plants', async () => {
    const { el } = await render();
    const items = Array.from(el.querySelectorAll('li'));

    expect(items.map((li) => li.querySelector('a')!.textContent!.trim())).toEqual(['Basil', 'My Chili', 'Tomato']);
    const clonable = items.filter((li) => li.querySelector('button.clone')).map((li) => li.querySelector('a')!.textContent!.trim());
    expect(clonable).toEqual(['Basil', 'Tomato']);
    const deletable = items.filter((li) => li.querySelector('button.delete-plant')).map((li) => li.querySelector('a')!.textContent!.trim());
    expect(deletable).toEqual(['My Chili']);
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
    el.querySelector<HTMLButtonElement>('button.add-plant')!.click();
    fixture.detectChanges();
    const name = el.querySelector<HTMLInputElement>('input[name=name]')!;
    name.value = 'Kale';
    name.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.add-plant-form [role=alert]')!.textContent).toContain('Sun requirement is required.');
    expect(service.addCustom).not.toHaveBeenCalled();
  });

  it('saves a valid custom plant and opens it', async () => {
    const created = plant({ id: 'new-1', user_id: 'me', name: 'Kale', sun_requirements: 'partial_shade' });
    service.addCustom.and.resolveTo(created);
    const { fixture, el } = await render();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    el.querySelector<HTMLButtonElement>('button.add-plant')!.click();
    fixture.detectChanges();

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
    expect(el.querySelector('[role=dialog]')).toBeNull(); // closed before leaving the page
  });

  it('adds plants in a dialog opened from the top of the page; closing it drops what was typed', async () => {
    const { fixture, el } = await render();
    expect(el.querySelector('[role=dialog]')).toBeNull();
    const open = () => {
      el.querySelector<HTMLButtonElement>('button.add-plant')!.click();
      fixture.detectChanges();
    };

    open();
    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.querySelector('.modal-title')!.textContent).toContain('Add a custom plant');
    expect(Array.from(dialog.querySelectorAll('.modal-footer button')).map((b) => b.textContent!.trim()))
      .toEqual(['Close', 'Save plant']);

    for (const close of [
      () => el.querySelector<HTMLButtonElement>('[role=dialog] .btn-close')!.click(),
      () => el.querySelector<HTMLButtonElement>('[role=dialog] button.close-dialog')!.click(),
    ]) {
      const name = el.querySelector<HTMLInputElement>('input[name=name]')!;
      name.value = 'Kale';
      name.dispatchEvent(new Event('input'));
      close();
      fixture.detectChanges();
      expect(el.querySelector('[role=dialog]')).toBeNull();
      open();
      expect(el.querySelector<HTMLInputElement>('input[name=name]')!.value).toBe('');
    }
    expect(service.addCustom).not.toHaveBeenCalled();
  });

  it('deletes your own plant with the ✕, after confirmation', async () => {
    service.deletePlant.and.resolveTo();
    const { fixture, el } = await render();
    const remove = el.querySelector<HTMLButtonElement>('button.delete-plant')!;
    expect(remove.getAttribute('aria-label')).toBe('Delete My Chili');

    remove.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.ask.calls.mostRecent().args[0].message).toContain('My Chili');
    expect(service.deletePlant).toHaveBeenCalledWith('3');
    expect(Array.from(el.querySelectorAll('li a')).map((a) => a.textContent!.trim())).toEqual(['Basil', 'Tomato']);
  });

  it('keeps the plant when the deletion is cancelled', async () => {
    dialog.ask.and.resolveTo(false);
    const { fixture, el } = await render();

    el.querySelector<HTMLButtonElement>('button.delete-plant')!.click();
    await fixture.whenStable();

    expect(service.deletePlant).not.toHaveBeenCalled();
  });

  it('explains why a planted plant can’t be deleted', async () => {
    service.deletePlant.and.rejectWith(new PlantInUseError());
    const { fixture, el } = await render();

    el.querySelector<HTMLButtonElement>('button.delete-plant')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('planted in your garden');
    expect(el.querySelectorAll('li').length).toBe(3);
  });

  it('shows an error when the catalog fails to load', async () => {
    service.list.and.rejectWith(new Error('offline'));
    const { el } = await render();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('offline');
  });

  const catmint: PlantCandidate = {
    wikidataId: 'Q2319755',
    name: "Šanta Walker's Low",
    latinName: "Nepeta racemosa 'Walker's Low'",
    rank: 'species',
    cultivar: "Walker's Low",
    articleTitle: 'Šanta hroznovitá',
    description: 'Šanta hroznovitá (Nepeta racemosa) je středně vysoká, modrofialově kvetoucí vytrvalá květina.',
    url: 'https://cs.wikipedia.org/wiki/%C5%A0anta_hroznovit%C3%A1',
    language: 'cs',
  };

  async function search(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }, el: HTMLElement, query: string) {
    const input = el.querySelector<HTMLInputElement>('input[type=search]')!;
    input.value = query;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('offers a web lookup once at least two letters are typed', async () => {
    const { fixture, el } = await render();
    expect(el.querySelector('button.lookup')).toBeNull();

    await search(fixture, el, 's');
    expect(el.querySelector('button.lookup')).toBeNull();
    await search(fixture, el, "  šanta walker's low ");
    expect(el.querySelector('button.lookup')!.textContent).toContain("Search “šanta walker's low” on the web");
  });

  it('shows what Wikipedia has, with the rank, the cultivar note and the source', async () => {
    lookup.lookup.and.resolveTo([catmint]);
    const { fixture, el } = await render();
    await search(fixture, el, "šanta walker's low");

    el.querySelector<HTMLButtonElement>('button.lookup')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(lookup.lookup).toHaveBeenCalledWith("šanta walker's low", 'en');
    const result = el.querySelector('.lookup-results .candidate')!;
    expect(result.textContent).toContain("Nepeta racemosa 'Walker's Low'");
    expect(result.textContent).toContain('species');
    expect(result.querySelector('.cultivar-note')!.textContent).toContain('“Walker\'s Low” itself isn’t on Wikipedia; the details are for Šanta hroznovitá.');
    const link = result.querySelector<HTMLAnchorElement>('a')!;
    expect([link.href, link.rel, link.target]).toEqual([catmint.url, 'noopener noreferrer', '_blank']);
    expect(el.querySelector('.lookup-results .card-footer')!.textContent).toContain('CC BY-SA 4.0');
  });

  it('looks up on Enter in the search box too', async () => {
    lookup.lookup.and.resolveTo([]);
    const { fixture, el } = await render();
    await search(fixture, el, 'zzz');

    el.querySelector('input[type=search]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(lookup.lookup).toHaveBeenCalledWith('zzz', 'en');
    expect(el.querySelector('.no-results')!.textContent).toContain('Nothing found on Wikipedia for “zzz”.');
  });

  it('pre-fills the form from a result, and saves only after the user picks the sun', async () => {
    lookup.lookup.and.resolveTo([catmint]);
    service.addCustom.and.resolveTo({ id: 'new' } as Plant);
    const { fixture, el } = await render();
    await search(fixture, el, "šanta walker's low");
    el.querySelector<HTMLButtonElement>('button.lookup')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('.candidate button.use')!.click();
    fixture.detectChanges();

    expect(el.querySelector<HTMLInputElement>('input[name=name]')!.value).toBe("Šanta Walker's Low");
    expect(el.querySelector<HTMLInputElement>('input[name=species]')!.value).toBe("Nepeta racemosa 'Walker's Low'");
    expect(el.querySelector<HTMLTextAreaElement>('textarea[name=notes]')!.value).toBe(
      `${catmint.description} (Source: Wikipedia, CC BY-SA 4.0)`,
    );
    expect(el.querySelector<HTMLInputElement>('input[name=sourceUrl]')!.value).toBe(catmint.url);
    expect(el.querySelector('.prefill-notice')!.textContent).toContain('choose the sun requirement');

    const form = el.querySelector<HTMLFormElement>('form')!;
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.addCustom).not.toHaveBeenCalled(); // the sun is still missing

    const sun = el.querySelector<HTMLSelectElement>('select[name=sun]')!;
    sun.value = 'full_sun';
    sun.dispatchEvent(new Event('change'));
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(service.addCustom).toHaveBeenCalledWith(jasmine.objectContaining({
      name: "Šanta Walker's Low",
      species: "Nepeta racemosa 'Walker's Low'",
      sun_requirements: 'full_sun',
      notes: `${catmint.description} (Source: Wikipedia, CC BY-SA 4.0)`,
      source_url: catmint.url,
    }));
    expect(photos.addWikimedia).not.toHaveBeenCalled(); // this result has no picture
  });

  it('gives a plant added from a result with a picture that picture as its photo', async () => {
    const image = { url: 'https://upload.wikimedia.org/n.jpg', author: 'Jane', license: 'CC BY-SA 4.0', licenseUrl: null, sourceUrl: 'https://commons.wikimedia.org/wiki/File:N.jpg' };
    lookup.lookup.and.resolveTo([{ ...catmint, image }]);
    service.addCustom.and.resolveTo({ id: 'new' } as Plant);
    const { fixture, el } = await render();
    await search(fixture, el, 'šanta');
    el.querySelector<HTMLButtonElement>('button.lookup')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector<HTMLImageElement>('.candidate img.lookup-thumb')!.src).toBe(image.url);

    el.querySelector<HTMLButtonElement>('.candidate button.use')!.click();
    fixture.detectChanges();
    const sun = el.querySelector<HTMLSelectElement>('select[name=sun]')!;
    sun.value = 'full_sun';
    sun.dispatchEvent(new Event('change'));
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(photos.addWikimedia).toHaveBeenCalledWith('new', image);
  });

  it('clears the pre-filled fields on request', async () => {
    lookup.lookup.and.resolveTo([catmint]);
    const { fixture, el } = await render();
    await search(fixture, el, 'šanta');
    el.querySelector<HTMLButtonElement>('button.lookup')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.candidate button.use')!.click();
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('.prefill-notice button')!.click();
    fixture.detectChanges();

    expect(el.querySelector('.prefill-notice')).toBeNull();
    expect(el.querySelector('input[name=species]')).toBeNull();
  });

  it("says when Samwise's server can't be reached", async () => {
    lookup.lookup.and.rejectWith(new FunctionError('unreachable'));
    const { fixture, el } = await render();
    await search(fixture, el, 'šanta');

    el.querySelector<HTMLButtonElement>('button.lookup')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.lookup-error')!.textContent).toContain('couldn’t be reached, so nothing was searched');
  });

  it('shows each plant’s main photo as a thumbnail, and a placeholder without one', async () => {
    photos.mainPhotos.and.resolveTo(new Map([['3', { plant_id: '3', displayUrl: 'https://storage.test/chili.jpg' } as any]]));
    const { fixture, el } = await render();
    await fixture.whenStable();
    fixture.detectChanges();

    const rows = Array.from(el.querySelectorAll('li'));
    const thumb = (name: string) => rows.find((li) => li.textContent!.includes(name))!.querySelector('.catalog-thumb')!;
    expect(thumb('My Chili').querySelector('img')!.getAttribute('src')).toBe('https://storage.test/chili.jpg');
    expect(thumb('Basil').querySelector('img')).toBeNull();
    expect(thumb('Basil').querySelector('app-icon')).not.toBeNull();

    thumb('My Chili').querySelector('img')!.dispatchEvent(new Event('error')); // e.g. a link that's gone
    fixture.detectChanges();
    expect(thumb('My Chili').querySelector('img')).toBeNull();
  });

  it('still lists the plants when the photos can’t be loaded', async () => {
    photos.mainPhotos.and.rejectWith(new Error('offline'));
    spyOn(console, 'error');
    const { fixture, el } = await render();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelectorAll('li').length).toBe(3);
    expect(el.querySelector('[role=alert]')).toBeNull();
  });
});
