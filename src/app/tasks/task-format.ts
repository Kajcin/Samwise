import { plantName, taskTypeKey } from '../plant-catalog/labels';
import { addDays, toIsoDate } from '../core/dates';
import type { LanguageService } from '../core/i18n/language.service';
import { TaskWithContext, taskPlaces } from './task.service';

/** What the formatting below needs: the current language and its texts. */
export type Translator = Pick<LanguageService, 'lang' | 't'>;

/**
 * A task's text in parts, for <app-task-text>: "Harvest — Tomato (Herbs: row 1 col 2)",
 * or for several plants "(3×: Herbs: row 1 col 2; row 2 col 1; Shade: row 3 col 1)".
 * Manual tasks have just the type.
 */
export interface TaskText {
  type: string;
  /** null for manual tasks. */
  plant: string | null;
  /** How many plants the task covers (0 for manual tasks). */
  count: number;
  /** Where they grow: each bed once, with its cells (1-based for people). */
  beds: { bed: string; cells: string[] }[];
}

export function taskText(task: TaskWithContext, i18n: Translator): TaskText {
  const places = taskPlaces(task);
  const beds: { id: string; bed: string; cells: string[] }[] = [];
  for (const p of places) {
    const cell = i18n.t('tasks.cell', { row: p.cell_row + 1, col: p.cell_col + 1 });
    const last = beds[beds.length - 1];
    if (last?.id === p.bed.id) last.cells.push(cell);
    else beds.push({ id: p.bed.id, bed: p.bed.name, cells: [cell] });
  }
  return {
    type: i18n.t(taskTypeKey(task.task_type)),
    plant: task.plant ? plantName(task.plant, i18n.lang()) : null,
    count: places.length,
    beds: beds.map(({ bed, cells }) => ({ bed, cells })),
  };
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

/**
 * When a task is due: a day as formatDueDate() gives it, or for a month-long task
 * "This month" (while it runs) or e.g. "July 2027" / "Červenec 2027"; for half a month
 * "Early this month", "Late May 2027" / "Konec května 2027".
 */
export function formatDue(
  dueDate: string,
  dueUntil: string | null | undefined,
  i18n: Translator,
  today: Date = new Date(),
): string {
  if (!dueUntil) return formatDueDate(dueDate, i18n, today);
  // A yearly rule's half month: early = 1st-15th, late = from the 16th (migration 0013).
  const part = dueDate.endsWith('-16') ? 'late' : dueUntil.endsWith('-15') ? 'early' : null;
  const todayIso = toIsoDate(today);
  if (dueDate <= todayIso && todayIso <= dueUntil) {
    return i18n.t(part === 'early' ? 'dates.earlyThisMonth' : part === 'late' ? 'dates.lateThisMonth' : 'dates.thisMonth');
  }
  const [y, m] = dueDate.split('-').map(Number);
  const text = part
    ? i18n.t(part === 'early' ? 'dates.earlyMonthYear' : 'dates.lateMonthYear', {
        month: i18n.t(`dates.monthOf.${m}`),
        year: String(y),
      })
    : i18n.t('dates.monthYear', { month: i18n.t(`months.${m}`), year: String(y) });
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** Tasks due on the same day, or during the same month (month-long tasks are their own group). */
export interface TaskDay<T> {
  date: string;
  /** Set for a group of month-long tasks: the month's last day. */
  until: string | null;
  tasks: T[];
}

/** Groups tasks by when they're due, keeping the input order (callers pass tasks sorted by due date). */
export function groupByDueDate<T extends { due_date: string; due_until?: string | null }>(tasks: T[]): TaskDay<T>[] {
  const days: TaskDay<T>[] = [];
  for (const task of tasks) {
    const until = task.due_until ?? null;
    const last = days[days.length - 1];
    if (last && last.date === task.due_date && last.until === until) last.tasks.push(task);
    else days.push({ date: task.due_date, until, tasks: [task] });
  }
  return days;
}
