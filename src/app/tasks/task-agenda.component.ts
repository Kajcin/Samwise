import { Component, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { SpinnerComponent } from '../core/loading/spinner.component';
import { LoadingComponent } from '../core/loading/loading.component';
import { ModalComponent } from '../core/modal/modal.component';
import { filterTasks, isOverdue, TaskService, TaskWithContext } from './task.service';
import { formatDue, groupByDueDate } from './task-format';
import { TaskTextComponent } from './task-text.component';
import { Bed, GardenService } from '../garden/garden.service';
import { TaskType } from '../plant-catalog/plant-catalog.service';
import { TASK_TYPE_ICONS, TASK_TYPES, taskTypeKey } from '../plant-catalog/labels';
import { Message, msg } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';
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
  imports: [TaskTextComponent, IconComponent, ModalComponent, SpinnerComponent, LoadingComponent],
  templateUrl: './task-agenda.component.html',
})
export class TaskAgendaComponent {
  private taskService = inject(TaskService);
  private garden = inject(GardenService);
  protected i18n = inject(LanguageService);

  protected readonly taskTypes = TASK_TYPES;
  protected readonly taskTypeKey = taskTypeKey;
  protected readonly taskIcons = TASK_TYPE_ICONS;
  protected readonly formatDue = formatDue;
  protected readonly isOverdue = isOverdue;

  loading = signal(true);
  error = signal<Message | null>(null);
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
  newTaskError = signal<Message | null>(null);
  busyTaskId = signal<string | null>(null);
  /** The "add a task" dialog. */
  addDialogOpen = signal(false);
  savingTask = signal(false);

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      const [tasks, beds] = await Promise.all([this.taskService.listAll(), this.garden.listBeds()]);
      this.tasks.set(tasks);
      this.beds.set(beds);
    } catch (e) {
      this.error.set(msg('tasks.errors.load', { detail: messageOf(e) }));
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
      this.error.set(msg('tasks.errors.update', { detail: messageOf(e) }));
    } finally {
      this.busyTaskId.set(null);
    }
  }

  /** Opens the "Add a task" dialog with the defaults: fertilizing, due today. */
  openAddDialog(): void {
    this.newTaskType.set('fertilize');
    this.newTaskDue.set(toIsoDate(new Date()));
    this.newTaskError.set(null);
    this.addDialogOpen.set(true);
  }

  /** Closes the dialog; what was chosen is dropped. */
  closeAddDialog(): void {
    this.addDialogOpen.set(false);
    this.newTaskError.set(null);
  }

  async addManualTask(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.newTaskDue()) {
      this.newTaskError.set(msg('tasks.errors.chooseDueDate'));
      return;
    }
    this.newTaskError.set(null);
    this.savingTask.set(true);
    try {
      await this.taskService.addManualTask(this.newTaskType(), this.newTaskDue());
      this.addDialogOpen.set(false);
      await this.refresh();
    } catch (e) {
      this.newTaskError.set(msg('tasks.errors.add', { detail: messageOf(e) }));
    } finally {
      this.savingTask.set(false);
    }
  }
}
