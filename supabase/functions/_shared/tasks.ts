// Loading tasks for the calendar, shared by connect-calendar and calendar-sync.
import type { EventTask } from './google.ts';

/** PostgREST select for a task plus the plant/bed it belongs to (mirrors the app's TASK_SELECT). */
export const TASK_EVENT_SELECT =
  'id, user_id, due_date, task_type, completed_at, google_calendar_event_id, ' +
  'planting:plantings(cell_row, cell_col, bed:beds(name), plant:plants_catalog(name))';

export interface TaskEventRow {
  id: string;
  user_id: string;
  due_date: string;
  task_type: string;
  completed_at: string | null;
  google_calendar_event_id: string | null;
  planting: {
    cell_row: number;
    cell_col: number;
    bed: { name: string } | null;
    plant: { name: string } | null;
  } | null;
}

/** The event fields for a task; location matches the app ("Herbs, row 1 col 2", 1-based). */
export function toEventTask(row: TaskEventRow): EventTask {
  const p = row.planting;
  return {
    task_id: row.id,
    due_date: row.due_date,
    task_type: row.task_type,
    completed_at: row.completed_at,
    google_calendar_event_id: row.google_calendar_event_id,
    plant_name: p?.plant?.name ?? null,
    location: p?.bed ? `${p.bed.name}, row ${p.cell_row + 1} col ${p.cell_col + 1}` : null,
  };
}
