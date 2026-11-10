import { formatDueDate, groupByDueDate, taskLocation, taskTitle } from './task-format';
import { TaskWithContext } from './task.service';

const base: TaskWithContext = {
  id: 't', user_id: 'me', planting_id: null, task_type: 'prune', due_date: '2026-11-16',
  completed_at: null, google_calendar_event_id: null, planting: null,
};
const planted: TaskWithContext = {
  ...base, planting_id: 'p1', task_type: 'harvest',
  planting: { cell_row: 0, cell_col: 1, bed: { id: 'b1', name: 'Herbs' }, plant: { name: 'Tomato' } },
};

describe('taskTitle / taskLocation', () => {
  it('names the plant and its place for generated tasks', () => {
    expect(taskTitle(planted)).toBe('Harvest — Tomato');
    expect(taskLocation(planted)).toBe('Herbs, row 1 col 2');
  });

  it('uses just the task type for manual tasks', () => {
    expect(taskTitle(base)).toBe('Prune');
    expect(taskLocation(base)).toBeNull();
  });
});

describe('formatDueDate', () => {
  const today = new Date(2026, 10, 10, 17, 30);

  it('uses relative words around today', () => {
    expect(formatDueDate('2026-11-10', today)).toBe('Today');
    expect(formatDueDate('2026-11-11', today)).toBe('Tomorrow');
    expect(formatDueDate('2026-11-09', today)).toBe('Yesterday');
  });

  it('spells out other dates', () => {
    expect(formatDueDate('2026-11-16', today)).toBe('Mon 16 Nov 2026');
  });
});

describe('groupByDueDate', () => {
  it('groups consecutive tasks with the same due date', () => {
    const tasks = [
      { id: 'a', due_date: '2026-11-10' },
      { id: 'b', due_date: '2026-11-10' },
      { id: 'c', due_date: '2026-11-12' },
    ];
    expect(groupByDueDate(tasks)).toEqual([
      { date: '2026-11-10', tasks: [tasks[0], tasks[1]] },
      { date: '2026-11-12', tasks: [tasks[2]] },
    ]);
  });

  it('returns no groups for no tasks', () => {
    expect(groupByDueDate([])).toEqual([]);
  });
});
