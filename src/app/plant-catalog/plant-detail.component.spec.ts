import { provideI18n } from '../core/i18n/i18n';
import { msg } from '../core/i18n/i18n';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { formToChanges, linkHost, PlantDetailComponent, PlantForm, validateCareRuleForm, validatePlantForm } from './plant-detail.component';
import { parseNumberInput } from '../core/number-input';
import { CareRule, Plant, PlantCatalogService, PlantInUseError } from './plant-catalog.service';
import { Router } from '@angular/router';
import { ConfirmDialogService } from '../core/confirm/confirm-dialog.service';

describe('validateCareRuleForm', () => {
  it('requires offset_days when timing_type is offset_from_planting', () => {
    expect(validateCareRuleForm('offset_from_planting', null, null)).toEqual(msg('plant.errors.offsetRequired'));
  });

  it('requires recurrence_days when timing_type is recurring', () => {
    expect(validateCareRuleForm('recurring', null, null)).toEqual(msg('plant.errors.recurrenceRequired'));
  });

  it('rejects a negative or fractional offset', () => {
    expect(validateCareRuleForm('offset_from_planting', -1, null)).toEqual(msg('plant.errors.offsetInvalid'));
    expect(validateCareRuleForm('offset_from_planting', 1.5, null)).toEqual(msg('plant.errors.offsetInvalid'));
  });

  it('rejects a recurrence shorter than one day', () => {
    expect(validateCareRuleForm('recurring', null, 0)).toEqual(msg('plant.errors.recurrenceInvalid'));
  });

  it('accepts a valid offset rule, including planting day', () => {
    expect(validateCareRuleForm('offset_from_planting', 10, null)).toBeNull();
    expect(validateCareRuleForm('offset_from_planting', 0, null)).toBeNull();
  });

  it('requires the month for a yearly rule (and nothing else)', () => {
    expect(validateCareRuleForm('yearly', null, null, null)).toEqual(msg('plant.errors.monthRequired'));
    expect(validateCareRuleForm('yearly', null, null, 7)).toBeNull();
  });

  it('accepts a valid recurring rule', () => {
    expect(validateCareRuleForm('recurring', null, 14)).toBeNull();
  });
});

describe('validatePlantForm', () => {
  const valid: PlantForm = {
    name: 'Catmint', species: '', sun: 'full_sun', wateringDays: null,
    floweringStart: null, floweringEnd: null, notes: '', sourceUrl: '',
  };

  it('accepts a plant with only a name and sun', () => {
    expect(validatePlantForm(valid)).toBeNull();
  });

  it('requires a name and sun', () => {
    expect(validatePlantForm({ ...valid, name: ' ' })).toEqual(msg('catalog.errors.nameRequired'));
    expect(validatePlantForm({ ...valid, sun: '' })).toEqual(msg('catalog.errors.sunRequired'));
  });

  it('wants watering as whole days from 1 to 365', () => {
    expect(validatePlantForm({ ...valid, wateringDays: 0 })).toEqual(msg('plant.errors.wateringInvalid'));
    expect(validatePlantForm({ ...valid, wateringDays: 2.5 })).toEqual(msg('plant.errors.wateringInvalid'));
    expect(validatePlantForm({ ...valid, wateringDays: 366 })).toEqual(msg('plant.errors.wateringInvalid'));
    expect(validatePlantForm({ ...valid, wateringDays: 7 })).toBeNull();
  });

  it('wants both flowering months or neither, allowing a range over the new year', () => {
    expect(validatePlantForm({ ...valid, floweringStart: 5 })).toEqual(msg('plant.errors.floweringBoth'));
    expect(validatePlantForm({ ...valid, floweringEnd: 9 })).toEqual(msg('plant.errors.floweringBoth'));
    expect(validatePlantForm({ ...valid, floweringStart: 12, floweringEnd: 3 })).toBeNull();
  });

  it('accepts only web addresses as the source link', () => {
    for (const bad of ['loukykvet.cz', 'javascript:alert(1)', 'ftp://x.cz', 'https://a b.cz']) {
      expect(validatePlantForm({ ...valid, sourceUrl: bad })).withContext(bad).toEqual(msg('plant.errors.sourceUrlInvalid'));
    }
    expect(validatePlantForm({ ...valid, sourceUrl: ' https://www.loukykvet.cz/obchod/2166-santa-walkers-low ' })).toBeNull();
  });
});

describe('formToChanges', () => {
  it('trims texts and stores empty ones as missing', () => {
    expect(
      formToChanges({
        name: ' Catmint ', species: ' ', sun: 'full_sun', wateringDays: 7,
        floweringStart: 5, floweringEnd: 9, notes: '  ', sourceUrl: ' https://x.cz/a ',
      }),
    ).toEqual({
      name: 'Catmint', species: null, sun_requirements: 'full_sun', watering_frequency_days: 7,
      flowering_start_month: 5, flowering_end_month: 9, notes: null, source_url: 'https://x.cz/a',
    });
  });
});

describe('linkHost', () => {
  it('shows a link by its site', () => {
    expect(linkHost('https://www.loukykvet.cz/obchod/2166-santa-walkers-low')).toBe('www.loukykvet.cz');
  });
});

describe('parseNumberInput', () => {
  it('treats an empty field as no value (not 0)', () => {
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('  ')).toBeNull();
  });

  it('parses numbers', () => {
    expect(parseNumberInput('14')).toBe(14);
    expect(parseNumberInput('0')).toBe(0);
  });
});

describe('PlantDetailComponent', () => {
  let service: jasmine.SpyObj<PlantCatalogService>;
  let dialog: jasmine.SpyObj<ConfirmDialogService>;

  const seeded: Plant = {
    id: 'p1', user_id: null, name: 'Tomato', species: 'Solanum lycopersicum', sun_requirements: 'full_sun',
    watering_frequency_days: 2, flowering_start_month: 6, flowering_end_month: 9, notes: null,
  };
  const custom: Plant = { ...seeded, id: 'p2', user_id: 'me', name: 'My Tomato' };
  const rules: CareRule[] = [
    { id: 'r2', plant_id: 'p1', task_type: 'fertilize', timing_type: 'recurring', offset_days: null, recurrence_days: 14, notes: null },
    { id: 'r1', plant_id: 'p1', task_type: 'harvest', timing_type: 'offset_from_planting', offset_days: 75, recurrence_days: null, notes: null },
  ];

  async function render(plant: Plant) {
    service.get.and.resolveTo(plant);
    TestBed.configureTestingModule({
      imports: [PlantDetailComponent],
      providers: [provideI18n(), 
        provideRouter([]),
        { provide: PlantCatalogService, useValue: service },
        { provide: ConfirmDialogService, useValue: dialog },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: plant.id })) } },
      ],
    });
    const fixture = TestBed.createComponent(PlantDetailComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    service = jasmine.createSpyObj<PlantCatalogService>('PlantCatalogService', [
      'get', 'listCareRules', 'addCareRule', 'updateCareRule', 'cloneToCustom', 'updatePlant', 'deletePlant', 'deleteCareRule',
    ]);
    service.listCareRules.and.resolveTo(rules);
    dialog = jasmine.createSpyObj<ConfirmDialogService>('ConfirmDialogService', ['ask']);
    dialog.ask.and.resolveTo(true);
  });

  it('shows a built-in plant read-only, with its rules in timeline order', async () => {
    const { el } = await render(seeded);

    expect(el.querySelector('h1')!.textContent).toContain('Tomato');
    expect(el.textContent).toContain('June to September');
    expect(Array.from(el.querySelectorAll('li')).map((li) => li.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Harvest — 75 days after planting',
      'Fertilize — every 14 days',
    ]);
    expect(el.querySelector('form')).toBeNull();
    expect(el.textContent).toContain('Clone to customize');
  });

  it('lets the owner add a recurring rule, sending only the recurrence days', async () => {
    service.addCareRule.and.resolveTo(rules[0]);
    const { fixture, el } = await render(custom);
    el.querySelector<HTMLButtonElement>('button.add-rule')!.click();
    fixture.detectChanges();

    const timing = el.querySelector<HTMLSelectElement>('select[name=timing]')!;
    timing.value = 'recurring';
    timing.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const days = el.querySelector<HTMLInputElement>('input[name=recurrence]')!;
    days.value = '7';
    days.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(service.addCareRule).toHaveBeenCalledWith('p2', {
      task_type: 'seed_start', timing_type: 'recurring', offset_days: null, recurrence_days: 7, month: null, month_part: null, notes: null,
    });
  });

  it('shows a validation error for a rule without days', async () => {
    const { fixture, el } = await render(custom);
    el.querySelector<HTMLButtonElement>('button.add-rule')!.click();
    fixture.detectChanges();

    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.rule-form [role=alert]')!.textContent).toContain('Offset days is required');
    expect(service.addCareRule).not.toHaveBeenCalled();
  });

  /** Sets a form field the way typing or choosing does. */
  function setField(el: HTMLElement, name: string, value: string) {
    const field = el.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name=${name}]`)!;
    field.value = value;
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input'));
  }

  it('offers editing only for your own plants', async () => {
    expect((await render(seeded)).el.querySelector('button.edit')).toBeNull();
    TestBed.resetTestingModule();
    expect((await render(custom)).el.querySelector('button.edit')).not.toBeNull();
  });

  it('edits a plant: all fields, including flowering months and a source link', async () => {
    const saved: Plant = {
      ...custom, name: 'Catmint', species: 'Nepeta × faassenii', watering_frequency_days: 7,
      flowering_start_month: 5, flowering_end_month: 9, notes: 'Cut back after flowering.',
      source_url: 'https://www.loukykvet.cz/obchod/2166-santa-walkers-low',
    };
    service.updatePlant.and.resolveTo(saved);
    const { fixture, el } = await render(custom);

    el.querySelector<HTMLButtonElement>('button.edit')!.click();
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('[name=name]')!.value).toBe('My Tomato'); // starts from the plant
    setField(el, 'name', 'Catmint');
    setField(el, 'species', 'Nepeta × faassenii');
    setField(el, 'watering', '7');
    setField(el, 'floweringFrom', '5');
    setField(el, 'floweringTo', '9');
    setField(el, 'notes', 'Cut back after flowering.');
    setField(el, 'sourceUrl', 'https://www.loukykvet.cz/obchod/2166-santa-walkers-low');
    el.querySelector<HTMLFormElement>('form.plant-form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.updatePlant).toHaveBeenCalledWith('p2', {
      name: 'Catmint', species: 'Nepeta × faassenii', sun_requirements: 'full_sun', watering_frequency_days: 7,
      flowering_start_month: 5, flowering_end_month: 9, notes: 'Cut back after flowering.',
      source_url: 'https://www.loukykvet.cz/obchod/2166-santa-walkers-low',
    });
    expect(el.querySelector('form.plant-form')).toBeNull(); // back to viewing
    expect(el.querySelector('h1')!.textContent).toContain('Catmint');
    expect(el.textContent).toContain('May to September');
    const link = el.querySelector<HTMLAnchorElement>('a.source-link')!;
    expect(link.textContent).toBe('www.loukykvet.cz');
    expect(link.href).toBe('https://www.loukykvet.cz/obchod/2166-santa-walkers-low');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.target).toBe('_blank');
  });

  it('keeps the form open with a message when the input is invalid', async () => {
    const { fixture, el } = await render(custom);
    el.querySelector<HTMLButtonElement>('button.edit')!.click();
    fixture.detectChanges();

    setField(el, 'floweringTo', ''); // "from" is still June
    el.querySelector<HTMLFormElement>('form.plant-form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.updatePlant).not.toHaveBeenCalled();
    expect(el.querySelector('form.plant-form [role=alert]')!.textContent).toContain('Choose both flowering months');
  });

  it('cancels editing without saving', async () => {
    const { fixture, el } = await render(custom);
    el.querySelector<HTMLButtonElement>('button.edit')!.click();
    fixture.detectChanges();

    setField(el, 'name', 'Something else');
    el.querySelector<HTMLButtonElement>('button.cancel')!.click();
    fixture.detectChanges();

    expect(service.updatePlant).not.toHaveBeenCalled();
    expect(el.querySelector('form.plant-form')).toBeNull();
    expect(el.querySelector('h1')!.textContent).toContain('My Tomato');
  });

  it('deletes a plant from the trash icon, after confirmation, and returns to the catalog', async () => {
    service.deletePlant.and.resolveTo();
    const { fixture, el } = await render(custom);
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

    el.querySelector<HTMLButtonElement>('button.delete-plant')!.click();
    await fixture.whenStable();

    const asked = dialog.ask.calls.mostRecent().args[0];
    expect(asked.title).toBe('Delete plant?');
    expect(asked.message).toContain('My Tomato');
    expect(asked.danger).toBeTrue();
    expect(service.deletePlant).toHaveBeenCalledWith('p2');
    expect(navigate).toHaveBeenCalledWith(['/plants']);
  });

  it('keeps the plant when the deletion is cancelled', async () => {
    dialog.ask.and.resolveTo(false);
    const { fixture, el } = await render(custom);

    el.querySelector<HTMLButtonElement>('button.delete-plant')!.click();
    await fixture.whenStable();

    expect(service.deletePlant).not.toHaveBeenCalled();
  });

  it('explains why a planted plant can’t be deleted', async () => {
    service.deletePlant.and.rejectWith(new PlantInUseError());
    const { fixture, el } = await render(custom);

    el.querySelector<HTMLButtonElement>('button.delete-plant')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('planted in your garden');
  });

  it('has no trash icon for built-in plants, and none in the edit form', async () => {
    expect((await render(seeded)).el.querySelector('button.delete-plant')).toBeNull();
    TestBed.resetTestingModule();
    const { fixture, el } = await render(custom);
    el.querySelector<HTMLButtonElement>('button.edit')!.click();
    fixture.detectChanges();
    expect(el.querySelector('form.plant-form button.delete-plant')).toBeNull();
  });

  it('deletes a care rule of your own plant (only there)', async () => {
    service.deleteCareRule.and.resolveTo();
    const { fixture, el } = await render(custom);
    expect(el.textContent).toContain('tasks already created stay as they are');
    service.listCareRules.and.resolveTo([rules[0]]);

    el.querySelector<HTMLButtonElement>('button.delete-rule')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.deleteCareRule).toHaveBeenCalledWith('r1'); // the first one shown (timeline order)
    expect(el.querySelectorAll('li').length).toBe(1);
    TestBed.resetTestingModule();
    expect((await render(seeded)).el.querySelector('button.delete-rule')).toBeNull();
  });

  it('adds a yearly rule for a month, with the new perennial task types', async () => {
    service.addCareRule.and.resolveTo(rules[0]);
    const { fixture, el } = await render(custom);
    el.querySelector<HTMLButtonElement>('button.add-rule')!.click();
    fixture.detectChanges();
    const set = (name: string, value: string) => {
      const field = el.querySelector<HTMLSelectElement>(`select[name=${name}]`)!;
      field.value = value;
      field.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };

    expect(Array.from(el.querySelectorAll<HTMLOptionElement>('select[name=task] option')).map((o) => o.textContent!.trim()))
      .toEqual(['Seed start', 'Transplant', 'Prune', 'Cut back', 'Fertilize', 'Mulch', 'Divide', 'Winter protection', 'Harvest']);
    set('task', 'cut_back');
    set('timing', 'yearly');
    expect(el.querySelector('input[name=offset]')).toBeNull();
    set('month', '7');
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(service.addCareRule).toHaveBeenCalledWith('p2', {
      task_type: 'cut_back', timing_type: 'yearly', offset_days: null, recurrence_days: null, month: 7, month_part: null, notes: null,
    });
  });

  it('adds a yearly rule for the end of a month', async () => {
    service.addCareRule.and.resolveTo(rules[0]);
    const { fixture, el } = await render(custom);
    el.querySelector<HTMLButtonElement>('button.add-rule')!.click();
    fixture.detectChanges();
    const set = (name: string, value: string) => {
      const field = el.querySelector<HTMLSelectElement>(`select[name=${name}]`)!;
      field.value = value;
      field.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    set('task', 'mulch');
    set('timing', 'yearly');
    set('month', '10');
    const parts = Array.from(el.querySelectorAll<HTMLInputElement>('input[name=monthPart]'));
    expect(parts.map((p) => p.labels![0].textContent!.trim())).toEqual(['Whole month', 'Beginning', 'End']);
    expect(parts[0].checked).toBeTrue(); // the whole month unless chosen otherwise

    parts[2].click();
    fixture.detectChanges();
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(service.addCareRule).toHaveBeenCalledWith('p2', jasmine.objectContaining({
      task_type: 'mulch', timing_type: 'yearly', month: 10, month_part: 'late',
    }));
  });

  it('shows yearly rules last, by month, as "every year in …"', async () => {
    service.listCareRules.and.resolveTo([
      { id: 'y2', plant_id: 'p1', task_type: 'winter_protection', timing_type: 'yearly', offset_days: null, recurrence_days: null, month: 11, notes: null },
      { id: 'y1', plant_id: 'p1', task_type: 'cut_back', timing_type: 'yearly', offset_days: null, recurrence_days: null, month: 7, notes: null },
      { id: 'y3', plant_id: 'p1', task_type: 'prune', timing_type: 'yearly', offset_days: null, recurrence_days: null, month: 5, month_part: 'early', notes: null },
      { id: 'y4', plant_id: 'p1', task_type: 'mulch', timing_type: 'yearly', offset_days: null, recurrence_days: null, month: 10, month_part: 'late', notes: null },
      ...rules,
    ]);
    const { el } = await render(seeded);

    expect(Array.from(el.querySelectorAll('li')).map((li) => li.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Harvest — 75 days after planting',
      'Fertilize — every 14 days',
      'Prune — every year in early May',
      'Cut back — every year in July',
      'Mulch — every year in late October',
      'Winter protection — every year in November',
    ]);
  });

  it('adds rules in a dialog opened from the + in the rules card (own plants only)', async () => {
    expect((await render(seeded)).el.querySelector('button.add-rule')).toBeNull();
    TestBed.resetTestingModule();
    const { fixture, el } = await render(custom);
    expect(el.querySelector('[role=dialog]')).toBeNull();
    const add = el.querySelector<HTMLButtonElement>('button.add-rule')!;
    expect(add.textContent!.trim()).toBe('Add'); // like "Edit" in the card above
    expect(add.getAttribute('aria-label')).toBe('Add rule');

    el.querySelector<HTMLButtonElement>('button.add-rule')!.click();
    fixture.detectChanges();

    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.querySelector('.modal-title')!.textContent).toContain('Add a care rule');
    expect(Array.from(dialog.querySelectorAll('.modal-footer button')).map((b) => b.textContent!.trim()))
      .toEqual(['Close', 'Add rule']);
  });

  it('closing the dialog (✕, Close or Escape) drops what was typed', async () => {
    const { fixture, el } = await render(custom);
    const open = () => {
      el.querySelector<HTMLButtonElement>('button.add-rule')!.click();
      fixture.detectChanges();
    };
    const closers = [
      () => el.querySelector<HTMLButtonElement>('[role=dialog] .btn-close')!.click(),
      () => el.querySelector<HTMLButtonElement>('[role=dialog] button.close-dialog')!.click(),
      () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    ];
    for (const close of closers) {
      open();
      const days = el.querySelector<HTMLInputElement>('input[name=offset]')!;
      days.value = '30';
      days.dispatchEvent(new Event('input'));
      close();
      fixture.detectChanges();
      expect(el.querySelector('[role=dialog]')).toBeNull();
      open();
      expect(el.querySelector<HTMLInputElement>('input[name=offset]')!.value).toBe('');
      el.querySelector<HTMLButtonElement>('[role=dialog] button.close-dialog')!.click();
      fixture.detectChanges();
    }
    expect(service.addCareRule).not.toHaveBeenCalled();
  });

  it('closes the dialog after adding the rule', async () => {
    service.addCareRule.and.resolveTo(rules[0]);
    const { fixture, el } = await render(custom);
    el.querySelector<HTMLButtonElement>('button.add-rule')!.click();
    fixture.detectChanges();

    const days = el.querySelector<HTMLInputElement>('input[name=offset]')!;
    days.value = '30';
    days.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('form.rule-form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.addCareRule).toHaveBeenCalled();
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('shows a picture placeholder, and for built-in plants the copy button by the title', async () => {
    const { el } = await render(seeded);

    expect(el.querySelector('.plant-image')!.textContent).toContain('No photo yet');
    expect(el.querySelector('button.clone')!.textContent).toContain('Clone to customize');
    expect(el.querySelector('.card-footer')!.textContent).toContain('built-in plant');
  });
});
