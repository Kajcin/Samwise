import { TestBed } from '@angular/core/testing';
import { provideI18n } from '../core/i18n/i18n';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';
import { UnreadableImageError } from '../core/image-resize';
import { PlantPhotosComponent, wikipediaQuery } from './plant-photos.component';
import { PlantPhoto, PlantPhotosService } from './plant-photos.service';
import { PlantCandidate, PlantLookupService } from './plant-lookup.service';

describe('wikipediaQuery', () => {
  it('searches by the Latin name without the cultivar, else by the name', () => {
    expect(wikipediaQuery("Nepeta racemosa 'Walker's Low'", 'Šanta')).toBe('Nepeta racemosa');
    expect(wikipediaQuery(null, 'Šalvěj')).toBe('Šalvěj');
    expect(wikipediaQuery('  ', 'Šalvěj')).toBe('Šalvěj');
  });
});

describe('PlantPhotosComponent', () => {
  let photos: jasmine.SpyObj<PlantPhotosService>;
  let lookup: jasmine.SpyObj<PlantLookupService>;
  let dialog: jasmine.SpyObj<ConfirmDialogService>;

  const photo = (id: string, overrides: Partial<PlantPhoto> = {}): PlantPhoto => ({
    id, plant_id: 'p1', kind: 'upload', storage_path: `me/p1/${id}.jpg`, url: null, attribution: null,
    is_main: false, created_at: '2026-11-24T10:00:00Z', displayUrl: `https://storage.test/${id}.jpg`, ...overrides,
  });
  const wiki = photo('w', {
    kind: 'wikimedia', storage_path: null, url: 'https://upload.wikimedia.org/sage.jpg', displayUrl: 'https://upload.wikimedia.org/sage.jpg',
    is_main: true,
    attribution: {
      author: 'Kurt Stüber', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Salvia.jpg',
    },
  });

  async function render(list: PlantPhoto[] = []) {
    photos.list.and.resolveTo(list);
    TestBed.configureTestingModule({
      imports: [PlantPhotosComponent],
      providers: [
        provideI18n(),
        { provide: PlantPhotosService, useValue: photos },
        { provide: PlantLookupService, useValue: lookup },
        { provide: ConfirmDialogService, useValue: dialog },
      ],
    });
    const fixture = TestBed.createComponent(PlantPhotosComponent);
    fixture.componentRef.setInput('plantId', 'p1');
    fixture.componentRef.setInput('plantName', 'Sage');
    fixture.componentRef.setInput('species', "Salvia officinalis 'Purpurascens'");
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const openDialog = async (source?: 'upload' | 'link' | 'wikipedia') => {
      el.querySelector<HTMLButtonElement>('button.add-photo')!.click();
      fixture.detectChanges();
      if (source) {
        el.querySelector<HTMLInputElement>(`#photo-source-${source}`)!.click();
        await settle();
      }
    };
    return { fixture, el, settle, openDialog };
  }

  beforeEach(() => {
    photos = jasmine.createSpyObj<PlantPhotosService>('PlantPhotosService', ['list', 'upload', 'addLink', 'addWikimedia', 'setMain', 'remove']);
    photos.upload.and.resolveTo();
    photos.addLink.and.resolveTo();
    photos.addWikimedia.and.resolveTo();
    photos.setMain.and.resolveTo();
    photos.remove.and.resolveTo();
    lookup = jasmine.createSpyObj<PlantLookupService>('PlantLookupService', ['lookup']);
    dialog = jasmine.createSpyObj<ConfirmDialogService>('ConfirmDialogService', ['ask']);
    dialog.ask.and.resolveTo(true);
  });

  it('shows a placeholder when there is no photo', async () => {
    const { el } = await render();
    expect(el.querySelector('img.main-photo')).toBeNull();
    expect(el.querySelector('.no-photo')!.textContent).toContain('No photo yet');
  });

  it('shows the main photo large with its Wikimedia credit, and the others as thumbnails', async () => {
    const { el } = await render([wiki, photo('u1')]);

    expect(el.querySelector<HTMLImageElement>('img.main-photo')!.src).toBe(wiki.displayUrl);
    const credit = el.querySelector('.credit')!;
    expect(credit.textContent).toContain('Main photo');
    expect(credit.textContent).toContain('Kurt Stüber');
    const links = Array.from(credit.querySelectorAll('a')).map((a) => [a.textContent!.trim(), a.href]);
    expect(links).toEqual([
      ['CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0'],
      ['Wikimedia Commons', 'https://commons.wikimedia.org/wiki/File:Salvia.jpg'],
    ]);
    expect(el.querySelectorAll('.thumbs button').length).toBe(2);
  });

  it('views another photo, makes it the main one, or deletes it after confirmation', async () => {
    const { el, settle } = await render([wiki, photo('u1')]);

    el.querySelectorAll<HTMLButtonElement>('.thumbs button')[1].click();
    await settle();
    expect(el.querySelector<HTMLImageElement>('img.main-photo')!.src).toBe('https://storage.test/u1.jpg');
    expect(el.querySelector('.credit')!.textContent).toContain('Your photo');

    el.querySelector<HTMLButtonElement>('button.set-main')!.click();
    await settle();
    expect(photos.setMain).toHaveBeenCalledWith('u1');

    el.querySelector<HTMLButtonElement>('button.delete-photo')!.click();
    await settle();
    expect(dialog.ask.calls.mostRecent().args[0].title).toBe('Delete photo?');
    expect(photos.remove).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'u1' }));
  });

  it('says so when a linked picture can’t be loaded', async () => {
    const { el, fixture } = await render([photo('l', { kind: 'link', storage_path: null, url: 'https://gone.test/x.jpg' })]);

    el.querySelector('img.main-photo')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(el.querySelector('.broken-note')!.textContent).toContain('couldn’t be loaded');
    expect(el.querySelector('.credit a')!.textContent).toBe('gone.test');
  });

  it('uploads the chosen photos one by one, then closes', async () => {
    const { el, settle, openDialog } = await render();
    await openDialog();
    const input = el.querySelector<HTMLInputElement>('input[name=files]')!;
    const files = [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })];
    Object.defineProperty(input, 'files', { value: files });
    input.dispatchEvent(new Event('change'));

    el.querySelector<HTMLFormElement>('form.photo-form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(photos.upload.calls.allArgs()).toEqual([['p1', files[0]], ['p1', files[1]]]);
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('explains a picture the browser can’t read, keeping the dialog open', async () => {
    photos.upload.and.rejectWith(new UnreadableImageError());
    const { el, settle, openDialog } = await render();
    await openDialog();
    const input = el.querySelector<HTMLInputElement>('input[name=files]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'IMG_1.heic')] });
    input.dispatchEvent(new Event('change'));

    el.querySelector<HTMLFormElement>('form.photo-form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(el.querySelector('.photo-form [role=alert]')!.textContent).toContain('“IMG_1.heic” isn’t a picture the browser can read');
  });

  it('adds a link, and refuses something that isn’t a web address', async () => {
    const { el, settle, openDialog } = await render();
    await openDialog('link');
    const input = el.querySelector<HTMLInputElement>('input[name=link]')!;
    const submit = async (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      el.querySelector<HTMLFormElement>('form.photo-form')!.dispatchEvent(new Event('submit'));
      await settle();
    };

    await submit('loukykvet.cz/photo.jpg');
    expect(photos.addLink).not.toHaveBeenCalled();
    expect(el.querySelector('.photo-form [role=alert]')!.textContent).toContain('http://');

    await submit('https://example.com/sage.jpg');
    expect(photos.addLink).toHaveBeenCalledWith('p1', 'https://example.com/sage.jpg');
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('finds pictures on Wikipedia by the Latin name and adds the chosen one', async () => {
    const sage: PlantCandidate = {
      wikidataId: 'Q1', name: 'Šalvěj lékařská', latinName: 'Salvia officinalis', rank: 'species', cultivar: null,
      articleTitle: 'Šalvěj lékařská', description: '…', url: 'https://cs.wikipedia.org/wiki/x', language: 'cs',
      image: { url: 'https://upload.wikimedia.org/sage.jpg', author: 'Kurt Stüber', license: 'CC BY-SA 3.0', licenseUrl: null, sourceUrl: 'https://commons.wikimedia.org/wiki/File:S.jpg' },
    };
    lookup.lookup.and.resolveTo([sage, { ...sage, wikidataId: 'Q2', image: null }]);
    const { el, settle, openDialog } = await render();

    await openDialog('wikipedia');

    expect(lookup.lookup).toHaveBeenCalledWith('Salvia officinalis', 'en');
    expect(el.querySelectorAll('.wiki-candidate').length).toBe(1); // only those with a picture
    el.querySelector<HTMLButtonElement>('.wiki-candidate button.use')!.click();
    await settle();
    expect(photos.addWikimedia).toHaveBeenCalledWith('p1', sage.image!);
  });

  it('says when Wikipedia has no picture', async () => {
    lookup.lookup.and.resolveTo([]);
    const { el, openDialog } = await render();
    await openDialog('wikipedia');
    expect(el.querySelector('.wiki-none')!.textContent).toContain('no free picture');
  });
});
