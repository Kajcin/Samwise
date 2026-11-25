import { TestBed } from '@angular/core/testing';
import { formatDue, formatDueDate, groupByDueDate, taskText } from './task-format';
import { TaskWithContext } from './task.service';
import { provideI18n } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';

const base: TaskWithContext = {
  id: 't', user_id: 'me', plant_id: null, task_type: 'prune', due_date: '2026-11-16',
  completed_at: null, google_calendar_event_id: null, plant: null, plantings: [],
};
const planted: TaskWithContext = {
  ...base, plant_id: 'tomato', task_type: 'harvest',
  plant: { name: 'Tomato', name_cs: 'Rajče' },
  plantings: [{ planting: { cell_row: 0, cell_col: 1, bed: { id: 'b1', name: 'Herbs' } } }],
};

function i18nIn(lang: 'en' | 'cs'): LanguageService {
  TestBed.configureTestingModule({ providers: [provideI18n()] });
  const i18n = TestBed.inject(LanguageService);
  i18n.use(lang);
  return i18n;
}

describe('taskText', () => {
  it('names the plant and its place for generated tasks', () => {
    expect(taskText(planted, i18nIn('en'))).toEqual({
      type: 'Harvest', plant: 'Tomato', places: [{ bed: 'Herbs', cell: 'row 1 col 2' }],
    });
  });

  it('has just the task type for manual tasks', () => {
    expect(taskText(base, i18nIn('en'))).toEqual({ type: 'Prune', plant: null, places: [] });
  });

  it('speaks Czech, with the Czech name of built-in plants', () => {
    const i18n = i18nIn('cs');
    expect(taskText(planted, i18n)).toEqual({
      type: 'Sklizeň', plant: 'Rajče', places: [{ bed: 'Herbs', cell: 'řádek 1, sloupec 2' }],
    });
    expect(taskText({ ...planted, plant: { name: 'Chilli', name_cs: null } }, i18n).plant).toBe('Chilli');
  });

  it('lists the places of a task covering several plants by bed', () => {
    const shared: TaskWithContext = {
      ...planted,
      plantings: [
        { planting: { cell_row: 0, cell_col: 0, bed: { id: 'b2', name: 'stinný záhonek' } } },
        { planting: { cell_row: 2, cell_col: 1, bed: { id: 'b1', name: 'okrasné bylinky' } } },
      ],
    };
    expect(taskText(shared, i18nIn('cs')).places).toEqual([
      { bed: 'okrasné bylinky', cell: 'řádek 3, sloupec 2' },
      { bed: 'stinný záhonek', cell: 'řádek 1, sloupec 1' },
    ]);
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

describe('formatDue', () => {
  const today = new Date(2026, 10, 24);

  it('names the month of a month-long task, or "this month" while it runs', () => {
    const en = i18nIn('en');
    expect(formatDue('2027-07-01', '2027-07-31', en, today)).toBe('July 2027');
    expect(formatDue('2026-11-01', '2026-11-30', en, today)).toBe('This month');
    expect(formatDue('2026-11-25', null, en, today)).toBe('Tomorrow'); // one-day tasks as before
  });

  it('names half a month (a yearly rule\'s early or late part)', () => {
    const en = i18nIn('en');
    expect(formatDue('2027-05-01', '2027-05-15', en, today)).toBe('Early May 2027');
    expect(formatDue('2027-10-16', '2027-10-31', en, today)).toBe('Late October 2027');
    expect(formatDue('2026-11-16', '2026-11-30', en, today)).toBe('Late this month');
    expect(formatDue('2026-11-01', '2026-11-15', en, new Date(2026, 10, 3))).toBe('Early this month');
  });

  it('in Czech too', () => {
    const cs = i18nIn('cs');
    expect(formatDue('2027-05-01', '2027-05-15', cs, today)).toBe('Začátek května 2027');
    expect(formatDue('2027-10-16', '2027-10-31', cs, today)).toBe('Konec října 2027');
    expect(formatDue('2026-11-16', '2026-11-30', cs, today)).toBe('Konec tohoto měsíce');
    expect(formatDue('2027-07-01', '2027-07-31', cs, today)).toBe('Červenec 2027');
    expect(formatDue('2026-11-01', '2026-11-30', cs, today)).toBe('Tento měsíc');
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
      { date: '2026-11-10', until: null, tasks: [tasks[0], tasks[1]] },
      { date: '2026-11-12', until: null, tasks: [tasks[2]] },
    ]);
  });

  it('keeps month-long tasks apart from one-day tasks on the 1st', () => {
    const tasks = [
      { id: 'a', due_date: '2027-07-01' },
      { id: 'b', due_date: '2027-07-01', due_until: '2027-07-31' },
      { id: 'c', due_date: '2027-07-01', due_until: '2027-07-31' },
    ];
    expect(groupByDueDate(tasks)).toEqual([
      { date: '2027-07-01', until: null, tasks: [tasks[0]] },
      { date: '2027-07-01', until: '2027-07-31', tasks: [tasks[1], tasks[2]] },
    ]);
  });

  it('returns no groups for no tasks', () => {
    expect(groupByDueDate([])).toEqual([]);
  });
});
