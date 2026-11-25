import { TestBed } from '@angular/core/testing';
import { provideI18n } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';
import { TaskTextComponent } from './task-text.component';
import { TaskWithContext } from './task.service';

describe('TaskTextComponent', () => {
  const basil: TaskWithContext = {
    id: 't', user_id: 'me', plant_id: 'basil', task_type: 'harvest', due_date: '2026-12-05',
    completed_at: null, google_calendar_event_id: null,
    plant: { name: 'Basil', name_cs: 'Bazalka' },
    plantings: [{ planting: { cell_row: 1, cell_col: 1, bed: { id: 'b1', name: 'bylinková spirála' } } }],
  };

  async function render(task: TaskWithContext, done = false) {
    TestBed.configureTestingModule({ providers: [provideI18n()] });
    TestBed.inject(LanguageService).use('cs');
    const fixture = TestBed.createComponent(TaskTextComponent);
    fixture.componentRef.setInput('task', task);
    fixture.componentRef.setInput('done', done);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { el, text: el.textContent!.replace(/\s+/g, ' ').trim() };
  }

  it('shows the plant in bold and the bed in italics: "type — plant (bed: cell)"', async () => {
    const { el, text } = await render(basil);

    expect(text).toBe('Sklizeň — Bazalka (bylinková spirála: řádek 2, sloupec 2)');
    expect(el.querySelector('strong.task-plant')!.textContent).toBe('Bazalka');
    expect(el.querySelector('small.task-places em.task-bed')!.textContent).toBe('bylinková spirála');
  });

  it('counts the plants of a shared task and names each bed once, before its cells', async () => {
    const { el, text } = await render({
      ...basil,
      plantings: [
        ...basil.plantings,
        { planting: { cell_row: 0, cell_col: 0, bed: { id: 'b2', name: 'okrasné bylinky' } } },
        { planting: { cell_row: 2, cell_col: 0, bed: { id: 'b1', name: 'bylinková spirála' } } },
      ],
    });

    expect(text).toBe(
      'Sklizeň — Bazalka (3×: bylinková spirála: řádek 2, sloupec 2; řádek 3, sloupec 1; okrasné bylinky: řádek 1, sloupec 1)',
    );
    expect(Array.from(el.querySelectorAll('em.task-bed')).map((e) => e.textContent)).toEqual([
      'bylinková spirála', 'okrasné bylinky',
    ]);
  });

  it('shows a manual task by its type alone', async () => {
    const { el, text } = await render({ ...basil, plant_id: null, plant: null, plantings: [] });

    expect(text).toBe('Sklizeň');
    expect(el.querySelector('strong, small')).toBeNull();
  });

  it('strikes out a done task, but not its place', async () => {
    const { el } = await render(basil, true);

    expect(el.querySelector('s')!.textContent!.trim()).toBe('Sklizeň — Bazalka');
    expect(el.querySelector('s small')).toBeNull();
  });
});
