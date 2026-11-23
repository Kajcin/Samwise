import { assertEquals } from 'jsr:@std/assert@1';
import { TaskEventRow, toEventTask } from './tasks.ts';

const base: TaskEventRow = {
  id: 't1', user_id: 'u1', due_date: '2026-11-20', task_type: 'harvest', completed_at: null,
  google_calendar_event_id: 'evt-1', planting: null,
};

Deno.test('toEventTask adds the plant and its place for generated tasks', () => {
  const task = toEventTask({
    ...base,
    planting: { cell_row: 0, cell_col: 1, bed: { name: 'Herbs' }, plant: { name: 'Tomato' } },
  });
  assertEquals(task, {
    task_id: 't1', due_date: '2026-11-20', task_type: 'harvest', completed_at: null, google_calendar_event_id: 'evt-1',
    plant_name: 'Tomato', location: 'Herbs, row 1 col 2',
  });
});

Deno.test('toEventTask leaves plant and place empty for manual tasks', () => {
  const task = toEventTask(base);
  assertEquals(task.plant_name, null);
  assertEquals(task.location, null);
});
