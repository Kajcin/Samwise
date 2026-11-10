import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { filterByStatus, TaskAgendaComponent } from './task-agenda.component';
import { TaskService, TaskWithContext } from './task.service';
import { GardenService } from '../garden/garden.service';

function task(overrides: Partial<TaskWithContext>): TaskWithContext {
  return {
    id: 'x', user_id: 'me', planting_id: null, task_type: 'prune', due_date: '2026-11-20',
    completed_at: null, google_calendar_event_id: null, planting: null, ...overrides,
  };
}

const herbs = { cell_row: 0, cell_col: 0, bed: { id: 'b1', name: 'Herbs' }, plant: { name: 'Basil' } };
const veg = { cell_row: 0, cell_col: 1, bed: { id: 'b2', name: 'Veg' }, plant: { name: 'Tomato' } };
const all = [
  task({ id: 'done', task_type: 'harvest', due_date: '2026-11-01', completed_at: '2026-11-01T09:00:00Z', planting_id: 'p1', planting: herbs }),
  task({ id: 'a', task_type: 'fertilize', due_date: '2026-11-20', planting_id: 'p1', planting: herbs }),
  task({ id: 'b', task_type: 'fertilize', due_date: '2026-11-20', planting_id: 'p2', planting: veg }),
  task({ id: 'c', task_type: 'prune', due_date: '2026-11-22' }),
];

describe('filterByStatus', () => {
  it('keeps unfinished tasks for "todo", finished for "done", everything for "all"', () => {
    expect(filterByStatus(all, 'todo').map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(filterByStatus(all, 'done').map((t) => t.id)).toEqual(['done']);
    expect(filterByStatus(all, 'all').length).toBe(4);
  });
});

describe('TaskAgendaComponent', () => {
  let tasks: jasmine.SpyObj<TaskService>;
  let garden: jasmine.SpyObj<GardenService>;

  async function render() {
    const fixture = TestBed.createComponent(TaskAgendaComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const choose = async (name: string, value: string) => {
      const select = el.querySelector<HTMLSelectElement>(`select[name=${name}]`)!;
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await settle();
    };
    const shown = () => Array.from(el.querySelectorAll('li.task')).map((li) => li.getAttribute('data-id'));
    return { fixture, el, settle, choose, shown };
  }

  beforeEach(() => {
    tasks = jasmine.createSpyObj<TaskService>('TaskService', ['listAll', 'markComplete', 'markIncomplete', 'addManualTask']);
    garden = jasmine.createSpyObj<GardenService>('GardenService', ['listBeds']);
    tasks.listAll.and.resolveTo(all);
    garden.listBeds.and.resolveTo([
      { id: 'b1', user_id: 'me', name: 'Herbs', rows: 1, cols: 1 },
      { id: 'b2', user_id: 'me', name: 'Veg', rows: 1, cols: 2 },
    ]);
    TestBed.configureTestingModule({
      imports: [TaskAgendaComponent],
      providers: [
        provideRouter([]),
        { provide: TaskService, useValue: tasks },
        { provide: GardenService, useValue: garden },
      ],
    });
  });

  it('shows unfinished tasks grouped by due date', async () => {
    const { el, shown } = await render();

    expect(shown()).toEqual(['a', 'b', 'c']);
    expect(el.querySelectorAll('section.day').length).toBe(2);
    expect(el.querySelector('section.day li')!.textContent).toContain('Fertilize — Basil');
  });

  it('filters by type, bed and status', async () => {
    const { choose, shown } = await render();

    await choose('type', 'prune');
    expect(shown()).toEqual(['c']);

    await choose('type', '');
    await choose('bed', 'b2');
    expect(shown()).toEqual(['b']);

    await choose('bed', '');
    await choose('status', 'done');
    expect(shown()).toEqual(['done']);
  });

  it('marks a task done, and undoes it', async () => {
    tasks.markComplete.and.resolveTo();
    tasks.markIncomplete.and.resolveTo();
    const { el, settle, choose } = await render();

    el.querySelector<HTMLButtonElement>('li.task[data-id=a] button')!.click();
    await settle();
    expect(tasks.markComplete).toHaveBeenCalledWith('a');
    expect(tasks.listAll).toHaveBeenCalledTimes(2);

    await choose('status', 'done');
    el.querySelector<HTMLButtonElement>('li.task[data-id=done] button')!.click();
    await settle();
    expect(tasks.markIncomplete).toHaveBeenCalledWith('done');
  });

  it('adds a manual task', async () => {
    tasks.addManualTask.and.resolveTo(task({ id: 'new' }));
    const { el, settle, choose } = await render();

    await choose('newType', 'harvest');
    const date = el.querySelector<HTMLInputElement>('input[name=newDue]')!;
    date.value = '2026-12-01';
    date.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('form.add-task')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(tasks.addManualTask).toHaveBeenCalledWith('harvest', '2026-12-01');
    expect(tasks.listAll).toHaveBeenCalledTimes(2);
  });

  it('requires a due date for a manual task', async () => {
    const { el, settle } = await render();

    const date = el.querySelector<HTMLInputElement>('input[name=newDue]')!;
    date.value = '';
    date.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('form.add-task')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('Choose a due date.');
    expect(tasks.addManualTask).not.toHaveBeenCalled();
  });
});
