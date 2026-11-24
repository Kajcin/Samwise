import { Component, DestroyRef, effect, ElementRef, inject, input, output, untracked, viewChild } from '@angular/core';
import { LanguageService } from '../i18n/language.service';

let nextId = 0;

/**
 * A Bootstrap modal (CSS only, no Bootstrap JavaScript) with a title and a ✕; the page
 * projects the rest, usually a form with .modal-body and .modal-footer, so the footer's
 * submit button submits it:
 *
 *   <app-modal [open]="dialogOpen()" [title]="…" (closed)="close()">
 *     <form (submit)="save($event)"><div class="modal-body">…</div><div class="modal-footer">…</div></form>
 *   </app-modal>
 *
 * Projected content belongs to the page and lives on while the dialog is closed: wrap a
 * form in @if (open) when its fields should start empty each time.
 *
 * The ✕ and Escape ask to close (`closed`); a click outside does nothing, so a stray click
 * can't throw away a half-filled form. On opening, the first field gets the focus; on
 * closing, it goes back to where it was.
 *
 * A body taller than the window scrolls while the title and the footer's buttons stay in
 * view (styles.scss, "Dialogs"); an error (role=alert) appearing in it scrolls into view.
 */
@Component({
  selector: 'app-modal',
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    @if (open()) {
      <div class="modal-backdrop fade show"></div>
      <div class="modal fade show d-block" tabindex="-1" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content" #content>
            <div class="modal-header">
              <h2 class="modal-title h5" [id]="titleId">{{ title() }}</h2>
              <button type="button" class="btn-close" [attr.aria-label]="i18n.t('common.close')" (click)="closed.emit()"></button>
            </div>
            <ng-content />
          </div>
        </div>
      </div>
    }
  `,
})
export class ModalComponent {
  open = input(false);
  title = input.required<string>();
  closed = output<void>();

  protected i18n = inject(LanguageService);
  protected readonly titleId = `modal-title-${++nextId}`;
  private content = viewChild<ElementRef<HTMLElement>>('content');
  private returnFocusTo: HTMLElement | null = null;

  constructor() {
    // Leaving the page with the dialog open (e.g. saving navigates away) mustn't keep
    // the next page from scrolling.
    inject(DestroyRef).onDestroy(() => {
      if (this.open()) document.body.classList.remove('modal-open');
    });
    effect(() => {
      const open = this.open();
      untracked(() => {
        // Bootstrap's .modal-open stops the page behind the dialog from scrolling.
        document.body.classList.toggle('modal-open', open);
        if (open) {
          const active = document.activeElement;
          this.returnFocusTo = active instanceof HTMLElement ? active : null;
        } else if (this.returnFocusTo?.isConnected) {
          this.returnFocusTo.focus();
          this.returnFocusTo = null;
        }
      });
    });
    effect(() => {
      const content = this.content()?.nativeElement;
      content?.querySelector<HTMLElement>('.modal-body input, .modal-body select, .modal-body textarea')?.focus();
    });
    // A long dialog scrolls its body, so an error appearing at its end may be out of
    // sight: bring it into view.
    effect((onCleanup) => {
      const content = this.content()?.nativeElement;
      if (!content) return;
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (!(node instanceof HTMLElement)) continue;
            const alert = node.matches('[role=alert]') ? node : node.querySelector<HTMLElement>('[role=alert]');
            if (alert) return alert.scrollIntoView({ block: 'nearest' });
          }
        }
      });
      observer.observe(content, { childList: true, subtree: true });
      onCleanup(() => observer.disconnect());
    });
  }

  protected onEscape(): void {
    if (this.open()) this.closed.emit();
  }
}
