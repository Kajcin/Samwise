import { filterTasks, isOverdue, Task, TaskService, TaskWithContext, TASK_SELECT } from './task.service';
import { supabase } from '../core/supabase-client';

/** Fake PostgREST query: every builder method is a spy returning the builder; awaiting it yields `result`. */
function fakeQuery(result: { data: unknown; error: unknown }) {
  const builder: any = {};
  for (const method of ['select', 'insert', 'update', 'eq', 'is', 'lte', 'order', 'single']) {
    builder[method] = jasmine.createSpy(method).and.callFake(() => builder);
  }
  builder.then = (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function task(overrides: Partial<TaskWithContext>): TaskWithContext {
  return {
    id: 'x', user_id: 'me', planting_id: null, task_type: 'harvest', due_date: '2026-08-20',
    completed_at: null, google_calendar_event_id: null, planting: null, ...overrides,
  };
}

describe('filterTasks', () => {
  const inHerbs = { cell_row: 0, cell_col: 0, bed: { id: 'bed-1', name: 'Herbs' }, plant: { name: 'Basil' } };
  const inVeg = { cell_row: 1, cell_col: 1, bed: { id: 'bed-2', name: 'Veg' }, plant: { name: 'Tomato' } };
  const tasks = [
    task({ id: '1', planting_id: 'p1', task_type: 'harvest', planting: inHerbs }),
    task({ id: '2', planting_id: 'p2', task_type: 'fertilize', planting: inVeg }),
    task({ id: '3', task_type: 'fertilize', completed_at: '2026-08-26T00:00:00Z' }),
  ];

  it('returns all tasks when no filter given', () => {
    expect(filterTasks(tasks, {})).toEqual(tasks);
  });

  it('filters by task_type', () => {
    expect(filterTasks(tasks, { taskType: 'fertilize' }).map((t) => t.id)).toEqual(['2', '3']);
  });

  it('filters by bed, which excludes manual tasks', () => {
    expect(filterTasks(tasks, { bedId: 'bed-1' }).map((t) => t.id)).toEqual(['1']);
  });

  it('combines filters', () => {
    expect(filterTasks(tasks, { taskType: 'fertilize', bedId: 'bed-2' }).map((t) => t.id)).toEqual(['2']);
  });
});

describe('isOverdue', () => {
  const today = new Date(2026, 7, 19, 18, 0); // late afternoon must not matter

  it('is true for an unfinished task due before today', () => {
    expect(isOverdue(task({ due_date: '2026-08-18' }), today)).toBeTrue();
  });

  it('is false for a task due today or later', () => {
    expect(isOverdue(task({ due_date: '2026-08-19' }), today)).toBeFalse();
    expect(isOverdue(task({ due_date: '2026-08-25' }), today)).toBeFalse();
  });

  it('is false for a completed task', () => {
    expect(isOverdue(task({ due_date: '2026-08-01', completed_at: '2026-08-02T10:00:00Z' }), today)).toBeFalse();
  });
});

describe('TaskService', () => {
  let service: TaskService;

  beforeEach(() => {
    service = new TaskService();
  });

  it('listAll() selects tasks with their planting context, ordered by due date', async () => {
    const rows = [task({ id: '1' })];
    const query = fakeQuery({ data: rows, error: null });
    spyOn(supabase, 'from').and.returnValue(query);

    expect(await service.listAll()).toEqual(rows);
    expect(supabase.from).toHaveBeenCalledWith('tasks');
    expect(query.select).toHaveBeenCalledWith(TASK_SELECT);
    expect(query.order).toHaveBeenCalledWith('due_date');
  });

  it('listUpcoming() asks for unfinished tasks due up to N days ahead, overdue included', async () => {
    const query = fakeQuery({ data: [], error: null });
    spyOn(supabase, 'from').and.returnValue(query);

    await service.listUpcoming(7, new Date(2026, 7, 28, 16, 45));

    expect(query.is).toHaveBeenCalledWith('completed_at', null);
    expect(query.lte).toHaveBeenCalledWith('due_date', '2026-09-04');
    expect(query.order).toHaveBeenCalledWith('due_date');
  });

  it('listAll() throws Supabase errors', async () => {
    spyOn(supabase, 'from').and.returnValue(fakeQuery({ data: null, error: new Error('boom') }));

    await expectAsync(service.listAll()).toBeRejectedWithError('boom');
  });

  it('markComplete() sets completed_at to the current time', async () => {
    const query = fakeQuery({ data: null, error: null });
    spyOn(supabase, 'from').and.returnValue(query);

    await service.markComplete('1');

    expect(query.update).toHaveBeenCalledWith({ completed_at: jasmine.any(String) });
    expect(query.eq).toHaveBeenCalledWith('id', '1');
  });

  it('markIncomplete() clears completed_at', async () => {
    const query = fakeQuery({ data: null, error: null });
    spyOn(supabase, 'from').and.returnValue(query);

    await service.markIncomplete('1');

    expect(query.update).toHaveBeenCalledWith({ completed_at: null });
    expect(query.eq).toHaveBeenCalledWith('id', '1');
  });

  it('addManualTask() inserts a task without a planting, owned by the current user', async () => {
    spyOn(supabase.auth, 'getUser').and.resolveTo({ data: { user: { id: 'me' } }, error: null } as any);
    const created: Partial<Task> = { id: 't1' };
    const query = fakeQuery({ data: created, error: null });
    spyOn(supabase, 'from').and.returnValue(query);

    expect(await service.addManualTask('prune', '2026-09-01')).toEqual(created as any);
    expect(query.insert).toHaveBeenCalledWith({ task_type: 'prune', due_date: '2026-09-01', user_id: 'me', planting_id: null });
    expect(query.select).toHaveBeenCalledWith(TASK_SELECT);
  });
});
