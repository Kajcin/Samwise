import { assertEquals } from 'jsr:@std/assert@1';
import { TaskEventRow, toEventTask } from './tasks.ts';

const base: TaskEventRow = {
  id: 't1', user_id: 'u1', due_date: '2026-11-20', task_type: 'harvest', completed_at: null,
  google_calendar_event_id: 'evt-1', plant: null, plantings: [],
};
const place = (bed: string, row: number, col: number) => ({ planting: { cell_row: row, cell_col: col, bed: { name: bed } } });

Deno.test('toEventTask adds the plant and its place for generated tasks', () => {
  const task = toEventTask({ ...base, plant: { name: 'Tomato' }, plantings: [place('Herbs', 0, 1)] });
  assertEquals(task, {
    task_id: 't1', due_date: '2026-11-20', due_until: null, task_type: 'harvest', completed_at: null, google_calendar_event_id: 'evt-1',
    plant_name: 'Tomato', plant_count: 1, location: 'Herbs: row 1 col 2', language: 'en',
  });
});

Deno.test('toEventTask lists every place of a task covering several plants, in order, a line per bed', () => {
  const task = toEventTask({
    ...base,
    plant: { name: 'Lungwort' },
    plantings: [place('Shade', 0, 0), place('Herbs', 2, 1), place('Herbs', 0, 3)],
  });
  assertEquals(task.plant_count, 3);
  assertEquals(task.location, 'Herbs: row 1 col 4; row 3 col 2\nShade: row 1 col 1');
});

Deno.test('toEventTask writes Czech plant names and places for Czech users', () => {
  const plantings = [place('Záhon', 2, 0)];

  const task = toEventTask({ ...base, plant: { name: 'Tomato', name_cs: 'Rajče' }, plantings }, 'cs');
  assertEquals([task.plant_name, task.location, task.language], ['Rajče', 'Záhon: řádek 3, sloupec 1', 'cs']);

  // A user's own plant has no Czech name: its name is used as typed.
  const own = toEventTask({ ...base, plant: { name: 'Chilli', name_cs: null }, plantings }, 'cs');
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
    const location = 'Herbs: ' + (app.tasks.cell as string).replace('{row}', '1').replace('{col}', '2');
    assertEquals(formatLocation('Herbs', 1, 2, lang), location, `${lang} location`);
  }
});
