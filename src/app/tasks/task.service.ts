import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase-client';
import { currentUserId } from '../core/current-user';
import { addDays, toIsoDate } from '../core/dates';
import { TaskType } from '../plant-catalog/plant-catalog.service';

export interface Task {
  id: string;
  user_id: string;
  /** null for manual tasks. */
  planting_id: string | null;
  task_type: TaskType;
  /** ISO date, YYYY-MM-DD. */
  due_date: string;
  completed_at: string | null;
  google_calendar_event_id: string | null;
}

/** Where a generated task's plant sits; null for manual tasks. */
export interface TaskPlanting {
  cell_row: number;
  cell_col: number;
  bed: { id: string; name: string };
  plant: { name: string };
}

export interface TaskWithContext extends Task {
  planting: TaskPlanting | null;
}

/** PostgREST select that embeds the planting's bed and plant (follows the FKs, RLS applies). */
export const TASK_SELECT = '*, planting:plantings(cell_row, cell_col, bed:beds(id, name), plant:plants_catalog(name))';

export interface TaskFilter {
  taskType?: TaskType;
  bedId?: string;
}

export function filterTasks<T extends TaskWithContext>(tasks: T[], filter: TaskFilter): T[] {
  return tasks.filter((t) => {
    if (filter.taskType && t.task_type !== filter.taskType) return false;
    if (filter.bedId && t.planting?.bed.id !== filter.bedId) return false;
    return true;
  });
}

/** Unfinished and due before `today`'s calendar date (time of day is ignored). */
export function isOverdue(task: Task, today: Date = new Date()): boolean {
  return !task.completed_at && task.due_date < toIsoDate(today);
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
      .insert({ task_type: taskType, due_date: dueDate, user_id: userId, planting_id: null })
      .select(TASK_SELECT)
      .single();
    if (error) throw error;
    return data as TaskWithContext;
  }
}
