import { TASK_TYPE_LABELS } from '../plant-catalog/labels';
import { addDays, toIsoDate } from '../core/dates';
import { TaskWithContext } from './task.service';

/** "Harvest — Tomato" for generated tasks, "Prune" for manual ones. */
export function taskTitle(task: TaskWithContext): string {
  const type = TASK_TYPE_LABELS[task.task_type];
  return task.planting ? `${type} — ${task.planting.plant.name}` : type;
}

/** "Herbs, row 1 col 2" (1-based for people), or null for manual tasks. */
export function taskLocation(task: TaskWithContext): string | null {
  const p = task.planting;
  return p ? `${p.bed.name}, row ${p.cell_row + 1} col ${p.cell_col + 1}` : null;
}

/** "Today", "Tomorrow", "Yesterday", otherwise e.g. "Mon 16 Nov 2026". */
export function formatDueDate(isoDate: string, today: Date = new Date()): string {
  if (isoDate === toIsoDate(today)) return 'Today';
  if (isoDate === toIsoDate(addDays(today, 1))) return 'Tomorrow';
  if (isoDate === toIsoDate(addDays(today, -1))) return 'Yesterday';
  // Built by hand rather than toLocaleDateString(), whose punctuation differs between browsers.
  const [y, m, d] = isoDate.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]} ${y}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface TaskDay<T> {
  date: string;
  tasks: T[];
}

/** Groups tasks by due date, keeping the input order (callers pass tasks sorted by due date). */
export function groupByDueDate<T extends { due_date: string }>(tasks: T[]): TaskDay<T>[] {
  const days: TaskDay<T>[] = [];
  for (const task of tasks) {
    const last = days[days.length - 1];
    if (last && last.date === task.due_date) last.tasks.push(task);
    else days.push({ date: task.due_date, tasks: [task] });
  }
  return days;
}
