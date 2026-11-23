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
    plant_name: 'Tomato', location: 'Herbs, row 1 col 2', language: 'en',
  });
});

Deno.test('toEventTask writes Czech plant names and places for Czech users', () => {
  const planting = { cell_row: 2, cell_col: 0, bed: { name: 'Záhon' }, plant: { name: 'Tomato', name_cs: 'Rajče' } };

  const task = toEventTask({ ...base, planting }, 'cs');
  assertEquals([task.plant_name, task.location, task.language], ['Rajče', 'Záhon, řádek 3, sloupec 1', 'cs']);

  // A user's own plant has no Czech name: its name is used as typed.
  const own = toEventTask({ ...base, planting: { ...planting, plant: { name: 'Chilli', name_cs: null } } }, 'cs');
  assertEquals(own.plant_name, 'Chilli');
});

Deno.test('toEventTask leaves plant and place empty for manual tasks', () => {
  const task = toEventTask(base);
  assertEquals(task.plant_name, null);
  assertEquals(task.location, null);
});

// The app (src/i18n/*.json) and the calendar events must name tasks and places alike.
Deno.test('event texts match the app\'s translations', async () => {
  const { TASK_LABELS } = await import('./google.ts');
  const { formatLocation } = await import('./tasks.ts');
  for (const lang of ['en', 'cs'] as const) {
    const app = JSON.parse(await Deno.readTextFile(new URL(`../../../src/i18n/${lang}.json`, import.meta.url)));
    assertEquals(TASK_LABELS[lang], app.taskTypes, `${lang} task types`);
    const location = (app.tasks.location as string)
      .replace('{bed}', 'Herbs').replace('{row}', '1').replace('{col}', '2');
    assertEquals(formatLocation('Herbs', 1, 2, lang), location, `${lang} location`);
  }
});
