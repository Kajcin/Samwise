// Loading tasks for the calendar, shared by connect-calendar and calendar-sync.
import type { EventTask, Language } from './google.ts';

/**
 * PostgREST select for a task plus its plant and the plantings it covers (mirrors the
 * app's TASK_SELECT). One task can cover several plantings of the same plant (migration 0019).
 */
export const TASK_EVENT_SELECT =
  'id, user_id, due_date, due_until, task_type, completed_at, google_calendar_event_id, ' +
  'plant:plants_catalog(name, name_cs), ' +
  'plantings:task_plantings(planting:plantings(cell_row, cell_col, bed:beds(name)))';

/** Where one of the task's plants grows. */
export interface TaskPlace {
  cell_row: number;
  cell_col: number;
  bed: { name: string } | null;
}

export interface TaskEventRow {
  id: string;
  user_id: string;
  due_date: string;
  /** Last day of a month-long task (yearly rules); null for one-day tasks. */
  due_until?: string | null;
  task_type: string;
  completed_at: string | null;
  google_calendar_event_id: string | null;
  /** null for manual tasks. name_cs: Czech name of a built-in plant (migration 0009). */
  plant?: { name: string; name_cs?: string | null } | null;
  /** The plantings the task covers; empty for manual tasks. */
  plantings?: { planting: TaskPlace | null }[] | null;
}

/**
 * The place of a task, as the app writes it ("{bed}: " and tasks.cell in src/i18n/*.json):
 * "Herbs: row 1 col 2" / "Herbs: řádek 1, sloupec 2", 1-based.
 */
export function formatLocation(bed: string, row: number, col: number, language: Language): string {
  return language === 'cs' ? `${bed}: řádek ${row}, sloupec ${col}` : `${bed}: row ${row} col ${col}`;
}

/** The task's places, by bed, then row, then column. */
export function taskPlaces(row: Pick<TaskEventRow, 'plantings'>): (TaskPlace & { bed: { name: string } })[] {
  return (row.plantings ?? [])
    .map((link) => link.planting)
    .filter((p): p is TaskPlace & { bed: { name: string } } => !!p?.bed)
    .sort((a, b) => a.bed.name.localeCompare(b.bed.name) || a.cell_row - b.cell_row || a.cell_col - b.cell_col);
}

/** The event fields for a task, in the user's language; every place on its own line. */
export function toEventTask(row: TaskEventRow, language: Language = 'en'): EventTask {
  const plant = row.plant;
  const places = taskPlaces(row);
  return {
    task_id: row.id,
    due_date: row.due_date,
    due_until: row.due_until ?? null,
    task_type: row.task_type,
    completed_at: row.completed_at,
    google_calendar_event_id: row.google_calendar_event_id,
    plant_name: plant ? (language === 'cs' && plant.name_cs) || plant.name : null,
    plant_count: places.length,
    location: places.length ? places.map((p) => formatLocation(p.bed.name, p.cell_row + 1, p.cell_col + 1, language)).join('\n') : null,
    language,
  };
}
