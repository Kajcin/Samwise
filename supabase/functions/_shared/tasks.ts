// Loading tasks for the calendar, shared by connect-calendar and calendar-sync.
import type { EventTask, Language } from './google.ts';

/** PostgREST select for a task plus the plant/bed it belongs to (mirrors the app's TASK_SELECT). */
export const TASK_EVENT_SELECT =
  'id, user_id, due_date, due_until, task_type, completed_at, google_calendar_event_id, ' +
  'planting:plantings(cell_row, cell_col, bed:beds(name), plant:plants_catalog(name, name_cs))';

export interface TaskEventRow {
  id: string;
  user_id: string;
  due_date: string;
  /** Last day of a month-long task (yearly rules); null for one-day tasks. */
  due_until?: string | null;
  task_type: string;
  completed_at: string | null;
  google_calendar_event_id: string | null;
  planting: {
    cell_row: number;
    cell_col: number;
    bed: { name: string } | null;
    /** name_cs: Czech name of a built-in plant (migration 0009). */
    plant: { name: string; name_cs?: string | null } | null;
  } | null;
}

/**
 * The place of a task, as the app writes it (tasks.location in src/i18n/*.json):
 * "Herbs, row 1 col 2" / "Herbs, řádek 1, sloupec 2", 1-based.
 */
export function formatLocation(bed: string, row: number, col: number, language: Language): string {
  return language === 'cs' ? `${bed}, řádek ${row}, sloupec ${col}` : `${bed}, row ${row} col ${col}`;
}

/** The event fields for a task, in the user's language. */
export function toEventTask(row: TaskEventRow, language: Language = 'en'): EventTask {
  const p = row.planting;
  const plant = p?.plant;
  return {
    task_id: row.id,
    due_date: row.due_date,
    due_until: row.due_until ?? null,
    task_type: row.task_type,
    completed_at: row.completed_at,
    google_calendar_event_id: row.google_calendar_event_id,
    plant_name: plant ? (language === 'cs' && plant.name_cs) || plant.name : null,
    location: p?.bed ? formatLocation(p.bed.name, p.cell_row + 1, p.cell_col + 1, language) : null,
    language,
  };
}
