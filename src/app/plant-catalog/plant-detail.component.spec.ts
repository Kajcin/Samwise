import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PlantDetailComponent, validateCareRuleForm } from './plant-detail.component';
import { parseNumberInput } from '../core/number-input';
import { CareRule, Plant, PlantCatalogService } from './plant-catalog.service';

describe('validateCareRuleForm', () => {
  it('requires offset_days when timing_type is offset_from_planting', () => {
    expect(validateCareRuleForm('offset_from_planting', null, null)).toBe('Offset days is required for an offset rule.');
  });

  it('requires recurrence_days when timing_type is recurring', () => {
    expect(validateCareRuleForm('recurring', null, null)).toBe('Recurrence days is required for a recurring rule.');
  });

  it('rejects a negative or fractional offset', () => {
    expect(validateCareRuleForm('offset_from_planting', -1, null)).toBe('Offset days must be a whole number of 0 or more.');
    expect(validateCareRuleForm('offset_from_planting', 1.5, null)).toBe('Offset days must be a whole number of 0 or more.');
  });

  it('rejects a recurrence shorter than one day', () => {
    expect(validateCareRuleForm('recurring', null, 0)).toBe('Recurrence days must be a whole number of 1 or more.');
  });

  it('accepts a valid offset rule, including planting day', () => {
    expect(validateCareRuleForm('offset_from_planting', 10, null)).toBeNull();
    expect(validateCareRuleForm('offset_from_planting', 0, null)).toBeNull();
  });

  it('accepts a valid recurring rule', () => {
    expect(validateCareRuleForm('recurring', null, 14)).toBeNull();
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
      providers: [
        provideRouter([]),
        { provide: PlantCatalogService, useValue: service },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: plant.id })) } },
      ],
    });
    const fixture = TestBed.createComponent(PlantDetailComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    service = jasmine.createSpyObj<PlantCatalogService>('PlantCatalogService', ['get', 'listCareRules', 'addCareRule', 'updateCareRule', 'cloneToCustom']);
    service.listCareRules.and.resolveTo(rules);
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
      task_type: 'seed_start', timing_type: 'recurring', offset_days: null, recurrence_days: 7, notes: null,
    });
  });

  it('shows a validation error for a rule without days', async () => {
    const { fixture, el } = await render(custom);

    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('Offset days is required');
    expect(service.addCareRule).not.toHaveBeenCalled();
  });
});
