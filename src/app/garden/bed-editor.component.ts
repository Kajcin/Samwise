import { Component, inject, signal } from '@angular/core';
import { IconComponent } from '../core/icons/icon.component';
import { Router, RouterLink } from '@angular/router';
import { GardenService } from './garden.service';
import { messageOf } from '../core/errors';
import { parseNumberInput } from '../core/number-input';
import { Message, msg } from '../core/i18n/i18n';
import { LanguageService } from '../core/i18n/language.service';

/** Largest rows/cols value; keeps the grid usable on screen. */
export const MAX_BED_SIZE = 20;

export function validateBedForm(name: string, rows: number | null, cols: number | null): Message | null {
  if (!name.trim()) return msg('bedEditor.errors.nameRequired');
  if (rows == null || cols == null || rows < 1 || cols < 1) return msg('bedEditor.errors.sizeAtLeastOne');
  if (!Number.isInteger(rows) || !Number.isInteger(cols)) return msg('bedEditor.errors.sizeWhole');
  if (rows > MAX_BED_SIZE || cols > MAX_BED_SIZE) return msg('bedEditor.errors.sizeAtMost', { max: MAX_BED_SIZE });
  return null;
}

@Component({
  selector: 'app-bed-editor',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './bed-editor.component.html',
})
export class BedEditorComponent {
  private garden = inject(GardenService);
  private router = inject(Router);
  protected i18n = inject(LanguageService);

  protected readonly maxSize = MAX_BED_SIZE;

  name = signal('');
  rows = signal<number | null>(3);
  cols = signal<number | null>(3);
  error = signal<Message | null>(null);
  saving = signal(false);

  setRows(value: string): void {
    this.rows.set(parseNumberInput(value));
  }

  setCols(value: string): void {
    this.cols.set(parseNumberInput(value));
  }

  async save(event: Event): Promise<void> {
    event.preventDefault();
    const rows = this.rows();
    const cols = this.cols();
    const validation = validateBedForm(this.name(), rows, cols);
    this.error.set(validation);
    if (validation) return;
    this.saving.set(true);
    try {
      await this.garden.createBed(this.name().trim(), rows!, cols!);
      await this.router.navigate(['/garden']);
    } catch (e) {
      this.error.set(msg('bedEditor.errors.save', { detail: messageOf(e) }));
    } finally {
      this.saving.set(false);
    }
  }
}
