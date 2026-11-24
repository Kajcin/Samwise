import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideI18n } from '../i18n/i18n';
import { ModalComponent } from './modal.component';

@Component({
  imports: [ModalComponent],
  template: `
    <button id="opener" (click)="open.set(true)">Open</button>
    <app-modal [open]="open()" title="Add a care rule" (closed)="open.set(false); closedCount = closedCount + 1">
      @if (open()) {
        <form><div class="modal-body"><select name="task"><option>Prune</option></select></div></form>
      }
    </app-modal>
  `,
})
class HostComponent {
  open = signal(false);
  closedCount = 0;
}

describe('ModalComponent', () => {
  async function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideI18n()] });
    const fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => document.body.classList.remove('modal-open'));

  it('opens with its title, focuses the first field and keeps the page behind still', async () => {
    const { fixture, el } = await setup();
    const opener = el.querySelector<HTMLButtonElement>('#opener')!;
    opener.focus();
    opener.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el.querySelector('[role=dialog]')!.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector('.modal-title')!.textContent).toContain('Add a care rule');
    expect(document.activeElement).toBe(el.querySelector('select[name=task]'));
    expect(document.body.classList).toContain('modal-open');
  });

  it('asks to close on ✕ and Escape, then gives the focus back', async () => {
    const { fixture, host, el } = await setup();
    const opener = el.querySelector<HTMLButtonElement>('#opener')!;

    for (const close of [
      () => el.querySelector<HTMLButtonElement>('.btn-close')!.click(),
      () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    ]) {
      opener.focus();
      opener.click();
      fixture.detectChanges();
      await fixture.whenStable();
      close();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(el.querySelector('[role=dialog]')).toBeNull();
      expect(document.activeElement).toBe(opener);
      expect(document.body.classList).not.toContain('modal-open');
    }
    expect(host.closedCount).toBe(2);
  });

  it('ignores a click outside the dialog', async () => {
    const { fixture, host, el } = await setup();
    host.open.set(true);
    fixture.detectChanges();

    el.querySelector<HTMLElement>('.modal')!.click();
    fixture.detectChanges();

    expect(host.closedCount).toBe(0);
    expect(el.querySelector('[role=dialog]')).not.toBeNull();
  });
});
