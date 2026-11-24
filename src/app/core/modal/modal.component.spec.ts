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

/** A dialog whose form is taller than the window, with an error that can appear at its end. */
@Component({
  imports: [ModalComponent],
  template: `
    <app-modal [open]="true" title="Add a plant" (closed)="0">
      <form>
        <div class="modal-body">
          <div style="height: 3000px">Lots of fields</div>
          @if (error()) {
            <div class="alert alert-danger" role="alert">Choose the sun.</div>
          }
        </div>
        <div class="modal-footer"><button type="submit">Save plant</button></div>
      </form>
    </app-modal>
  `,
})
class LongFormHostComponent {
  error = signal(false);
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

  it('scrolls a body taller than the window, keeping the buttons in view', async () => {
    TestBed.configureTestingModule({ imports: [LongFormHostComponent], providers: [provideI18n()] });
    const fixture = TestBed.createComponent(LongFormHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const body = el.querySelector<HTMLElement>('.modal-body')!;
    expect(getComputedStyle(body).overflowY).toBe('auto');
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    expect(el.querySelector('.modal-footer button')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    fixture.destroy();
  });

  it('brings an error that appears into view', async () => {
    TestBed.configureTestingModule({ imports: [LongFormHostComponent], providers: [provideI18n()] });
    const fixture = TestBed.createComponent(LongFormHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const scrolled = spyOn(HTMLElement.prototype, 'scrollIntoView');

    fixture.componentInstance.error.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve)); // the observer reports after the change

    expect(scrolled).toHaveBeenCalled();
    expect(scrolled.calls.mostRecent().object).toBe(fixture.nativeElement.querySelector('[role=alert]'));
    fixture.destroy();
  });

  it('releases the page when destroyed while open (e.g. after navigating away)', async () => {
    const { fixture, host } = await setup();
    host.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.body.classList).toContain('modal-open');

    fixture.destroy();

    expect(document.body.classList).not.toContain('modal-open');
  });
});
