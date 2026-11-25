import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase-client';
import { currentUserId } from '../core/current-user';
import { addDays, toIsoDate } from '../core/dates';
import { TaskType } from '../plant-catalog/plant-catalog.service';

export interface Task {
  id: string;
  user_id: string;
  /** The plant of a generated task (migration 0019); null for manual tasks. */
  plant_id?: string | null;
  task_type: TaskType;
  /** ISO date, YYYY-MM-DD. */
  due_date: string;
  /** A task due during a period (a yearly rule's month) ends on this day; null for one-day tasks. */
  due_until?: string | null;
  completed_at: string | null;
  google_calendar_event_id: string | null;
}

/** Where one of a task's plants grows. */
export interface TaskPlace {
  cell_row: number;
  cell_col: number;
  bed: { id: string; name: string };
}

/**
 * A task with its plant and the plantings it covers: one task can cover several plants
 * of the same kind (migration 0019). Manual tasks have neither.
 */
export interface TaskWithContext extends Task {
  /** name_cs: Czech name of a built-in plant. */
  plant: { name: string; name_cs?: string | null } | null;
  plantings: { planting: TaskPlace | null }[];
}

/** PostgREST select that embeds the plant and the plantings' beds (follows the FKs, RLS applies). */
export const TASK_SELECT =
  '*, plant:plants_catalog(name, name_cs), plantings:task_plantings(planting:plantings(cell_row, cell_col, bed:beds(id, name)))';

/** The task's places, by bed, then row, then column. */
export function taskPlaces(task: Pick<TaskWithContext, 'plantings'>): TaskPlace[] {
  return (task.plantings ?? [])
    .map((link) => link.planting)
    .filter((p): p is TaskPlace => !!p?.bed)
    .sort(
      (a, b) =>
        a.bed.name.localeCompare(b.bed.name) ||
        a.bed.id.localeCompare(b.bed.id) || // beds of the same name stay apart
        a.cell_row - b.cell_row ||
        a.cell_col - b.cell_col,
    );
}

export interface TaskFilter {
  taskType?: TaskType;
  bedId?: string;
}

export function filterTasks<T extends TaskWithContext>(tasks: T[], filter: TaskFilter): T[] {
  return tasks.filter((t) => {
    if (filter.taskType && t.task_type !== filter.taskType) return false;
    if (filter.bedId && !taskPlaces(t).some((p) => p.bed.id === filter.bedId)) return false;
    return true;
  });
}

/** Unfinished and due before `today`'s calendar date (time of day is ignored). */
/** Not done, and its day (or, for a month-long task, its whole month) is over. */
export function isOverdue(task: Task, today: Date = new Date()): boolean {
  return !task.completed_at && (task.due_until ?? task.due_date) < toIsoDate(today);
}

@Injectable({ providedIn: 'root' })
export class TaskService {
  async listAll(): Promise<TaskWithContext[]> {
    const { data, error } = await supabase.from('tasks').select(TASK_SELECT).order('due_date');
    if (error) throw error;
    return data as TaskWithContext[];
  }

  /** Unfinished tasks due within `days` days of `today`, including overdue ones. */
  async listUpcoming(days: number, today: Date = new Date()): Promise<TaskWithContext[]> {
    const { data, error } = await supabase
      .from('tasks')
      .select(TASK_SELECT)
      .is('completed_at', null)
      .lte('due_date', toIsoDate(addDays(today, days)))
      .order('due_date');
    if (error) throw error;
    return data as TaskWithContext[];
  }

  async markComplete(taskId: string): Promise<void> {
    const { error } = await supabase.from('tasks').update({ completed_at: new Date().toISOString() }).eq('id', taskId);
    if (error) throw error;
  }

  async markIncomplete(taskId: string): Promise<void> {
    const { error } = await supabase.from('tasks').update({ completed_at: null }).eq('id', taskId);
    if (error) throw error;
  }

  async addManualTask(taskType: TaskType, dueDate: string): Promise<TaskWithContext> {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('tasks')
      .insert({ task_type: taskType, due_date: dueDate, user_id: userId })
      .select(TASK_SELECT)
      .single();
    if (error) throw error;
    return data as TaskWithContext;
  }
}
