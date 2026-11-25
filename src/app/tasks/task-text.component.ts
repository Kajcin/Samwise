import { booleanAttribute, ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { LanguageService } from '../core/i18n/language.service';
import { TaskWithContext } from './task.service';
import { taskText } from './task-format';

/**
 * A task as one line of text, the plant in bold and each bed in italics:
 *   Sklizeň — **Bazalka** (_bylinková spirála_: řádek 2, sloupec 2)
 *   Sklizeň — **Bazalka** (2×: _okrasné bylinky_: řádek 3, sloupec 2; _stinný záhonek_: …)
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
    @if (text.places.length) {
      <small class="task-places text-body-secondary">
        ({{ text.places.length > 1 ? text.places.length + '×: ' : '' }}@for (place of text.places; track $index) {@if (!$first) {; }<em class="task-bed">{{ place.bed }}</em>: {{ place.cell }}})
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
