import { Component, computed, inject, signal } from '@angular/core';
import { filterTasks, isOverdue, TaskService, TaskWithContext } from './task.service';
import { formatDueDate, groupByDueDate, taskLocation, taskTitle } from './task-format';
import { Bed, GardenService } from '../garden/garden.service';
import { TaskType } from '../plant-catalog/plant-catalog.service';
import { TASK_TYPE_LABELS, TASK_TYPES } from '../plant-catalog/labels';
import { messageOf } from '../core/errors';
import { toIsoDate } from '../core/dates';

export type StatusFilter = 'todo' | 'done' | 'all';

export function filterByStatus<T extends TaskWithContext>(tasks: T[], status: StatusFilter): T[] {
  if (status === 'all') return tasks;
  return tasks.filter((t) => (status === 'done') === !!t.completed_at);
}

@Component({
  selector: 'app-task-agenda',
  standalone: true,
  templateUrl: './task-agenda.component.html',
})
export class TaskAgendaComponent {
  private taskService = inject(TaskService);
  private garden = inject(GardenService);

  protected readonly taskTypes = TASK_TYPES;
  protected readonly taskLabels = TASK_TYPE_LABELS;
  protected readonly taskTitle = taskTitle;
  protected readonly taskLocation = taskLocation;
  protected readonly formatDueDate = formatDueDate;
  protected readonly isOverdue = isOverdue;

  loading = signal(true);
  error = signal<string | null>(null);
  private tasks = signal<TaskWithContext[]>([]);
  beds = signal<Bed[]>([]);

  typeFilter = signal<TaskType | ''>('');
  bedFilter = signal('');
  statusFilter = signal<StatusFilter>('todo');
  days = computed(() =>
    groupByDueDate(
      filterByStatus(
        filterTasks(this.tasks(), { taskType: this.typeFilter() || undefined, bedId: this.bedFilter() || undefined }),
        this.statusFilter(),
      ),
    ),
  );

  newTaskType = signal<TaskType>('fertilize');
  newTaskDue = signal(toIsoDate(new Date()));
  newTaskError = signal<string | null>(null);
  busyTaskId = signal<string | null>(null);

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      const [tasks, beds] = await Promise.all([this.taskService.listAll(), this.garden.listBeds()]);
      this.tasks.set(tasks);
      this.beds.set(beds);
    } catch (e) {
      this.error.set(`Could not load tasks: ${messageOf(e)}`);
    } finally {
      this.loading.set(false);
    }
  }

  private async refresh(): Promise<void> {
    this.tasks.set(await this.taskService.listAll());
  }

  onTypeFilter(value: string): void {
    this.typeFilter.set(value as TaskType | '');
  }

  onStatusFilter(value: string): void {
    this.statusFilter.set(value as StatusFilter);
  }

  async toggleDone(task: TaskWithContext): Promise<void> {
    this.busyTaskId.set(task.id);
    this.error.set(null);
    try {
      if (task.completed_at) await this.taskService.markIncomplete(task.id);
      else await this.taskService.markComplete(task.id);
      await this.refresh();
    } catch (e) {
      this.error.set(`Could not update the task: ${messageOf(e)}`);
    } finally {
      this.busyTaskId.set(null);
    }
  }

  async addManualTask(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.newTaskDue()) {
      this.newTaskError.set('Choose a due date.');
      return;
    }
    this.newTaskError.set(null);
    try {
      await this.taskService.addManualTask(this.newTaskType(), this.newTaskDue());
      await this.refresh();
    } catch (e) {
      this.newTaskError.set(`Could not add the task: ${messageOf(e)}`);
    }
  }
}
