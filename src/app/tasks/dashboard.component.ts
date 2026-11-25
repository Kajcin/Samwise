import { Component, inject, signal } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { SpinnerComponent } from '../core/loading/spinner.component';
import { LoadingComponent } from '../core/loading/loading.component';
import { TASK_TYPE_ICONS } from '../plant-catalog/labels';
import { RouterLink } from '@angular/router';
import { isOverdue, TaskService, TaskWithContext } from './task.service';
import { formatDue, taskLocation, taskTitle } from './task-format';
import { Bed, GardenService, slotCount } from '../garden/garden.service';
import { messageOf } from '../core/errors';
import { Message, msg } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';

export interface BedSummary {
  bed: Bed;
  plantingCount: number;
}

export function groupByBedSummary(beds: Bed[], activePlantingCounts: Map<string, number>): BedSummary[] {
  return beds.map((bed) => ({ bed, plantingCount: activePlantingCounts.get(bed.id) ?? 0 }));
}

/** Days ahead the dashboard looks (overdue unfinished tasks are always included). */
const UPCOMING_DAYS = 7;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, IconComponent, SpinnerComponent, LoadingComponent],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  protected readonly slotCount = slotCount;
  private tasks = inject(TaskService);
  private garden = inject(GardenService);
  protected i18n = inject(LanguageService);

  protected readonly days = UPCOMING_DAYS;
  protected readonly taskTitle = taskTitle;
  protected readonly taskIcons = TASK_TYPE_ICONS;
  protected readonly taskLocation = taskLocation;
  protected readonly formatDue = formatDue;
  protected readonly isOverdue = isOverdue;

  loading = signal(true);
  error = signal<Message | null>(null);
  upcoming = signal<TaskWithContext[]>([]);
  bedSummaries = signal<BedSummary[]>([]);
  busyTaskId = signal<string | null>(null);

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      await Promise.all([this.loadTasks(), this.loadBeds()]);
    } catch (e) {
      this.error.set(msg('dashboard.errors.load', { detail: messageOf(e) }));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadTasks(): Promise<void> {
    this.upcoming.set(await this.tasks.listUpcoming(UPCOMING_DAYS));
  }

  private async loadBeds(): Promise<void> {
    const beds = await this.garden.listBeds();
    const counts = await Promise.all(beds.map(async (bed) => [bed.id, (await this.garden.listActivePlantings(bed.id)).length] as const));
    this.bedSummaries.set(groupByBedSummary(beds, new Map(counts)));
  }

  async markDone(task: TaskWithContext): Promise<void> {
    this.busyTaskId.set(task.id);
    this.error.set(null);
    try {
      await this.tasks.markComplete(task.id);
      await this.loadTasks();
    } catch (e) {
      this.error.set(msg('tasks.errors.update', { detail: messageOf(e) }));
    } finally {
      this.busyTaskId.set(null);
    }
  }
}
