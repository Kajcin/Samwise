import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardComponent, groupByBedSummary } from './dashboard.component';
import { Bed, GardenService } from '../garden/garden.service';
import { TaskService, TaskWithContext } from './task.service';
import { toIsoDate, addDays } from '../core/dates';

describe('groupByBedSummary', () => {
  it('counts active plantings per bed', () => {
    const beds: Bed[] = [{ id: 'b1', user_id: 'me', name: 'Front', rows: 2, cols: 2 }];
    const activePlantingCounts = new Map([['b1', 3]]);
    expect(groupByBedSummary(beds, activePlantingCounts)).toEqual([{ bed: beds[0], plantingCount: 3 }]);
  });

  it('defaults to 0 plantings for a bed with none recorded', () => {
    const beds: Bed[] = [{ id: 'b2', user_id: 'me', name: 'Back', rows: 1, cols: 1 }];
    expect(groupByBedSummary(beds, new Map())).toEqual([{ bed: beds[0], plantingCount: 0 }]);
  });
});

describe('DashboardComponent', () => {
  let tasks: jasmine.SpyObj<TaskService>;
  let garden: jasmine.SpyObj<GardenService>;

  const today = new Date();
  const overdue: TaskWithContext = {
    id: 't1', user_id: 'me', planting_id: 'p1', task_type: 'fertilize', due_date: toIsoDate(addDays(today, -2)),
    completed_at: null, google_calendar_event_id: null,
    planting: { cell_row: 0, cell_col: 0, bed: { id: 'b1', name: 'Herbs' }, plant: { name: 'Basil' } },
  };
  const manualToday: TaskWithContext = {
    id: 't2', user_id: 'me', planting_id: null, task_type: 'prune', due_date: toIsoDate(today),
    completed_at: null, google_calendar_event_id: null, planting: null,
  };
  const beds: Bed[] = [
    { id: 'b1', user_id: 'me', name: 'Herbs', rows: 2, cols: 2 },
    { id: 'b2', user_id: 'me', name: 'Veg', rows: 1, cols: 3 },
  ];

  async function render() {
    const fixture = TestBed.createComponent(DashboardComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    tasks = jasmine.createSpyObj<TaskService>('TaskService', ['listUpcoming', 'markComplete']);
    garden = jasmine.createSpyObj<GardenService>('GardenService', ['listBeds', 'listActivePlantings']);
    tasks.listUpcoming.and.resolveTo([overdue, manualToday]);
    garden.listBeds.and.resolveTo(beds);
    garden.listActivePlantings.and.callFake(async (bedId: string) => (bedId === 'b1' ? [{}, {}] : []) as any);
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: TaskService, useValue: tasks },
        { provide: GardenService, useValue: garden },
      ],
    });
  });

  it('lists overdue and upcoming tasks with their plant and place', async () => {
    const { el } = await render();
    const items = Array.from(el.querySelectorAll('.task')).map((li) => li.textContent!.replace(/\s+/g, ' ').trim());

    expect(tasks.listUpcoming).toHaveBeenCalledWith(7);
    expect(items[0]).toContain('Fertilize — Basil');
    expect(items[0]).toContain('Herbs, row 1 col 1');
    expect(items[0]).toContain('Overdue');
    expect(items[1]).toContain('Prune');
    expect(items[1]).toContain('Today');
    expect(items[1]).not.toContain('Overdue');
  });

  it('removes a task from the list once it is marked done', async () => {
    tasks.markComplete.and.resolveTo();
    const { fixture, el } = await render();
    tasks.listUpcoming.and.resolveTo([manualToday]);

    (el.querySelector('.task button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(tasks.markComplete).toHaveBeenCalledWith('t1');
    expect(el.querySelectorAll('.task').length).toBe(1);
  });

  it('summarises each bed with its planting count', async () => {
    const { el } = await render();
    const beds = Array.from(el.querySelectorAll('.bed')).map((li) => li.textContent!.replace(/\s+/g, ' ').trim());

    expect(beds).toEqual(['Herbs — 2 of 4 cells planted', 'Veg — 0 of 3 cells planted']);
  });

  it('has friendly empty states', async () => {
    tasks.listUpcoming.and.resolveTo([]);
    garden.listBeds.and.resolveTo([]);
    const { el } = await render();

    expect(el.textContent).toContain('Nothing to do in the next 7 days.');
    expect(el.querySelector('a[href="/garden/new"]')).not.toBeNull();
  });

  it('shows an error when loading fails', async () => {
    tasks.listUpcoming.and.rejectWith(new Error('offline'));
    const { el } = await render();

    expect(el.querySelector('[role=alert]')!.textContent).toContain('offline');
  });
});
