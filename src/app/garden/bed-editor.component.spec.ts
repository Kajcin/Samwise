import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BedEditorComponent, MAX_BED_SIZE, validateBedForm } from './bed-editor.component';
import { GardenService } from './garden.service';

describe('validateBedForm', () => {
  it('rejects an empty name', () => {
    expect(validateBedForm('  ', 3, 3)).toBe('Name is required.');
  });

  it('rejects missing or non-positive dimensions', () => {
    expect(validateBedForm('Bed 1', 0, 3)).toBe('Rows and columns must be at least 1.');
    expect(validateBedForm('Bed 1', 3, -1)).toBe('Rows and columns must be at least 1.');
    expect(validateBedForm('Bed 1', null, 3)).toBe('Rows and columns must be at least 1.');
  });

  it('rejects fractional dimensions', () => {
    expect(validateBedForm('Bed 1', 2.5, 3)).toBe('Rows and columns must be whole numbers.');
  });

  it(`rejects dimensions above ${MAX_BED_SIZE}`, () => {
    expect(validateBedForm('Bed 1', MAX_BED_SIZE + 1, 3)).toBe(`Rows and columns can be at most ${MAX_BED_SIZE}.`);
  });

  it('accepts a valid form', () => {
    expect(validateBedForm('Bed 1', 3, 4)).toBeNull();
    expect(validateBedForm('Bed 1', 1, MAX_BED_SIZE)).toBeNull();
  });
});

describe('BedEditorComponent', () => {
  let garden: jasmine.SpyObj<GardenService>;

  async function render() {
    const fixture = TestBed.createComponent(BedEditorComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const type = (name: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const submit = async () => {
      el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { el, type, submit };
  }

  beforeEach(() => {
    garden = jasmine.createSpyObj<GardenService>('GardenService', ['createBed']);
    TestBed.configureTestingModule({
      imports: [BedEditorComponent],
      providers: [provideRouter([]), { provide: GardenService, useValue: garden }],
    });
  });

  it('creates the bed with a trimmed name and opens the garden', async () => {
    garden.createBed.and.resolveTo({ id: 'b1', user_id: 'me', name: 'Herbs', rows: 2, cols: 4 });
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const { type, submit } = await render();

    type('name', '  Herbs ');
    type('rows', '2');
    type('cols', '4');
    await submit();

    expect(garden.createBed).toHaveBeenCalledWith('Herbs', 2, 4);
    expect(navigate).toHaveBeenCalledWith(['/garden']);
  });

  it('treats an emptied number field as missing, not 0', async () => {
    const { el, type, submit } = await render();

    type('name', 'Herbs');
    type('rows', '');
    await submit();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('Rows and columns must be at least 1.');
    expect(garden.createBed).not.toHaveBeenCalled();
  });

  it('shows the error when saving fails', async () => {
    garden.createBed.and.rejectWith(new Error('network down'));
    const { el, type, submit } = await render();

    type('name', 'Herbs');
    await submit();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('network down');
  });
});
