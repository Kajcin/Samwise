import { plantName, taskTypeKey } from '../plant-catalog/labels';
import { addDays, toIsoDate } from '../core/dates';
import type { LanguageService } from '../core/i18n/language.service';
import { TaskWithContext } from './task.service';

/** What the formatting below needs: the current language and its texts. */
export type Translator = Pick<LanguageService, 'lang' | 't'>;

/** "Harvest — Tomato" for generated tasks, "Prune" for manual ones. */
export function taskTitle(task: TaskWithContext, i18n: Translator): string {
  const type = i18n.t(taskTypeKey(task.task_type));
  if (!task.planting) return type;
  return i18n.t('tasks.title', { type, plant: plantName(task.planting.plant, i18n.lang()) });
}

/** "Herbs, row 1 col 2" (1-based for people), or null for manual tasks. */
export function taskLocation(task: TaskWithContext, i18n: Translator): string | null {
  const p = task.planting;
  return p ? i18n.t('tasks.location', { bed: p.bed.name, row: p.cell_row + 1, col: p.cell_col + 1 }) : null;
}

/** "Today", "Tomorrow", "Yesterday", otherwise e.g. "Mon 16 Nov 2026" / "Po 16. listopadu 2026". */
export function formatDueDate(isoDate: string, i18n: Translator, today: Date = new Date()): string {
  if (isoDate === toIsoDate(today)) return i18n.t('dates.today');
  if (isoDate === toIsoDate(addDays(today, 1))) return i18n.t('dates.tomorrow');
  if (isoDate === toIsoDate(addDays(today, -1))) return i18n.t('dates.yesterday');
  // Built by hand rather than toLocaleDateString(), whose punctuation differs between browsers.
  const [y, m, d] = isoDate.split('-').map(Number);
  return i18n.t('dates.full', {
    weekday: i18n.t(`dates.weekdays.${new Date(y, m - 1, d).getDay()}`),
    day: d,
    month: i18n.t(`dates.monthsInDate.${m}`),
    year: String(y),
  });
}

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
