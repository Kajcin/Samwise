import { Component, effect, ElementRef, inject, viewChild } from '@angular/core';
import { IconComponent } from '../icons/icon.component';
import { LanguageService } from '../i18n/language.service';
import { ConfirmDialogService } from './confirm-dialog.service';

/**
 * The dialog behind ConfirmDialogService, as a Bootstrap modal (CSS only, no Bootstrap
 * JavaScript). Cancel has the focus at first, so Enter never deletes by accident;
 * Escape, the close button and a click outside all cancel.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [IconComponent],
  host: { '(document:keydown.escape)': 'dialog.answer(false)' },
  template: `
    @if (dialog.current(); as d) {
      <div class="modal-backdrop fade show"></div>
      <div
        class="modal fade show d-block"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        (click)="onBackdropClick($event)"
      >
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h2 class="modal-title h5" id="confirm-dialog-title">{{ d.title }}</h2>
              <button type="button" class="btn-close" [attr.aria-label]="i18n.t('common.close')" (click)="dialog.answer(false)"></button>
            </div>
            <div class="modal-body">
              <p class="mb-0" id="confirm-dialog-message">{{ d.message }}</p>
            </div>
            <div class="modal-footer">
              <button #cancelButton type="button" class="btn btn-outline-secondary cancel" (click)="dialog.answer(false)">
                {{ d.cancelLabel }}
              </button>
              <button
                type="button"
                class="btn confirm"
                [class.btn-danger]="d.danger"
                [class.btn-primary]="!d.danger"
                (click)="dialog.answer(true)"
              >
                @if (d.confirmIcon) {
                  <app-icon [name]="d.confirmIcon" class="me-1" />
                }
                {{ d.confirmLabel }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  protected dialog = inject(ConfirmDialogService);
  protected i18n = inject(LanguageService);
  private cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    effect(() => this.cancelButton()?.nativeElement.focus());
    // Bootstrap's .modal-open stops the page behind the dialog from scrolling.
    effect(() => document.body.classList.toggle('modal-open', !!this.dialog.current()));
  }

  /** A click on the dimmed area around the dialog (not inside it) cancels. */
  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.dialog.answer(false);
  }
}
