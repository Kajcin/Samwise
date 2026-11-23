import { TestBed } from '@angular/core/testing';
import { formatDueDate, groupByDueDate, taskLocation, taskTitle } from './task-format';
import { TaskWithContext } from './task.service';
import { provideI18n } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';

const base: TaskWithContext = {
  id: 't', user_id: 'me', planting_id: null, task_type: 'prune', due_date: '2026-11-16',
  completed_at: null, google_calendar_event_id: null, planting: null,
};
const planted: TaskWithContext = {
  ...base, planting_id: 'p1', task_type: 'harvest',
  planting: { cell_row: 0, cell_col: 1, bed: { id: 'b1', name: 'Herbs' }, plant: { name: 'Tomato', name_cs: 'Rajče' } },
};

function i18nIn(lang: 'en' | 'cs'): LanguageService {
  TestBed.configureTestingModule({ providers: [provideI18n()] });
  const i18n = TestBed.inject(LanguageService);
  i18n.use(lang);
  return i18n;
}

describe('taskTitle / taskLocation', () => {
  it('names the plant and its place for generated tasks', () => {
    const i18n = i18nIn('en');
    expect(taskTitle(planted, i18n)).toBe('Harvest — Tomato');
    expect(taskLocation(planted, i18n)).toBe('Herbs, row 1 col 2');
  });

  it('uses just the task type for manual tasks', () => {
    const i18n = i18nIn('en');
    expect(taskTitle(base, i18n)).toBe('Prune');
    expect(taskLocation(base, i18n)).toBeNull();
  });

  it('speaks Czech, with the Czech name of built-in plants', () => {
    const i18n = i18nIn('cs');
    expect(taskTitle(planted, i18n)).toBe('Sklizeň — Rajče');
    expect(taskLocation(planted, i18n)).toBe('Herbs, řádek 1, sloupec 2');
    const own = { ...planted, planting: { ...planted.planting!, plant: { name: 'Chilli', name_cs: null } } };
    expect(taskTitle(own, i18n)).toBe('Sklizeň — Chilli');
  });
});

describe('formatDueDate', () => {
  const today = new Date(2026, 10, 10, 17, 30);

  it('uses relative words around today', () => {
    const i18n = i18nIn('en');
    expect(formatDueDate('2026-11-10', i18n, today)).toBe('Today');
    expect(formatDueDate('2026-11-11', i18n, today)).toBe('Tomorrow');
    expect(formatDueDate('2026-11-09', i18n, today)).toBe('Yesterday');
  });

  it('spells out other dates', () => {
    expect(formatDueDate('2026-11-16', i18nIn('en'), today)).toBe('Mon 16 Nov 2026');
  });

  it('spells out dates in Czech', () => {
    const i18n = i18nIn('cs');
    expect(formatDueDate('2026-11-10', i18n, today)).toBe('Dnes');
    expect(formatDueDate('2026-11-16', i18n, today)).toBe('Po 16. listopadu 2026');
  });
});

describe('groupByDueDate', () => {
  it('groups consecutive tasks with the same due date', () => {
    const tasks = [
      { id: 'a', due_date: '2026-11-10' },
      { id: 'b', due_date: '2026-11-10' },
      { id: 'c', due_date: '2026-11-12' },
    ];
    expect(groupByDueDate(tasks)).toEqual([
      { date: '2026-11-10', tasks: [tasks[0], tasks[1]] },
      { date: '2026-11-12', tasks: [tasks[2]] },
    ]);
  });

  it('returns no groups for no tasks', () => {
    expect(groupByDueDate([])).toEqual([]);
  });
});
