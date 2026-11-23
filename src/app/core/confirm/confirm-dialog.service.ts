import { computed, Injectable, signal } from '@angular/core';
import type { IconName } from '../icons/icons.generated';

export interface ConfirmOptions {
  /** Already translated, like all texts here. */
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** A destructive action: the confirm button is red. */
  danger?: boolean;
  confirmIcon?: IconName;
}

interface OpenDialog extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
  /** Gets the focus back when the dialog closes. */
  returnFocusTo: HTMLElement | null;
}

/**
 * Asks the user to confirm, in Samwise's own dialog (ConfirmDialogComponent, placed
 * once in the app shell):
 *
 *   if (await confirmDialog.ask({ title, message, confirmLabel, cancelLabel, danger: true })) { … }
 */
@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private open = signal<OpenDialog | null>(null);
  readonly current = computed<ConfirmOptions | null>(() => this.open());

  ask(options: ConfirmOptions): Promise<boolean> {
    this.answer(false); // a dialog still open counts as cancelled
    const active = document.activeElement;
    return new Promise((resolve) =>
      this.open.set({ ...options, resolve, returnFocusTo: active instanceof HTMLElement ? active : null }),
    );
  }

  answer(confirmed: boolean): void {
    const dialog = this.open();
    if (!dialog) return;
    this.open.set(null);
    dialog.resolve(confirmed);
    if (dialog.returnFocusTo?.isConnected) dialog.returnFocusTo.focus();
  }
}
