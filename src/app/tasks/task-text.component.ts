import { booleanAttribute, ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { LanguageService } from '../core/i18n/language.service';
import { TaskWithContext } from './task.service';
import { taskText } from './task-format';

/**
 * A task as one line of text, the plant in bold and each bed in italics:
 *   Sklizeň — **Bazalka** (_bylinková spirála_: řádek 2, sloupec 2)
 *   Sklizeň — **Bazalka** (3×: _okrasné bylinky_: řádek 1, sloupec 2; řádek 3, sloupec 2; _stinný záhonek_: …)
 * Each bed is named once, before its cells.
 * `done` strikes the task out (not its places).
 */
@Component({
  selector: 'app-task-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let text = taskText(task(), i18n);
    @if (done()) {
      <s class="text-body-secondary">{{ text.type }}@if (text.plant) { — <strong class="task-plant">{{ text.plant }}</strong>}</s>
    } @else {
      {{ text.type }}@if (text.plant) { — <strong class="task-plant">{{ text.plant }}</strong>}
    }
    @if (text.count) {
      <small class="task-places text-body-secondary">
        ({{ text.count > 1 ? text.count + '×: ' : '' }}@for (bed of text.beds; track $index) {@if (!$first) {; }<em class="task-bed">{{ bed.bed }}</em>: {{ bed.cells.join('; ') }}})
      </small>
    }
  `,
})
export class TaskTextComponent {
  protected i18n = inject(LanguageService);
  protected readonly taskText = taskText;
  task = input.required<TaskWithContext>();
  done = input(false, { transform: booleanAttribute });
}
