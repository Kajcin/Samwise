import { TestBed } from '@angular/core/testing';
import { provideI18n } from '../i18n/i18n';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import { ConfirmDialogService } from './confirm-dialog.service';

describe('ConfirmDialogComponent', () => {
  const options = { title: 'Delete plant?', message: 'Basil will be deleted.', confirmLabel: 'Delete', cancelLabel: 'Cancel', danger: true };

  async function setup() {
    TestBed.configureTestingModule({ imports: [ConfirmDialogComponent], providers: [provideI18n()] });
    const fixture = TestBed.createComponent(ConfirmDialogComponent);
    const service = TestBed.inject(ConfirmDialogService);
    await fixture.whenStable();
    const open = async () => {
      const answer = service.ask(options);
      fixture.detectChanges();
      await fixture.whenStable();
      return answer;
    };
    return { fixture, el: fixture.nativeElement as HTMLElement, open };
  }

  it('shows nothing until asked', async () => {
    const { el } = await setup();
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('shows the question, with a red confirm button and the focus on Cancel', async () => {
    const { el, open } = await setup();
    void open();
    await new Promise((r) => setTimeout(r));

    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.querySelector('#confirm-dialog-title')!.textContent).toContain('Delete plant?');
    expect(dialog.textContent).toContain('Basil will be deleted.');
    expect(dialog.querySelector('button.confirm')!.classList).toContain('btn-danger');
    expect(document.activeElement).toBe(dialog.querySelector('button.cancel'));
    expect(document.body.classList).toContain('modal-open'); // the page behind doesn't scroll
  });

  it('answers yes on confirm and closes', async () => {
    const { fixture, el, open } = await setup();
    const answer = open();
    await new Promise((r) => setTimeout(r));

    el.querySelector<HTMLButtonElement>('button.confirm')!.click();
    fixture.detectChanges();

    expect(await answer).toBeTrue();
    expect(el.querySelector('[role=dialog]')).toBeNull();
    await fixture.whenStable();
    expect(document.body.classList).not.toContain('modal-open');
  });

  it('answers no on Cancel, the close button, Escape or a click outside', async () => {
    const { fixture, el, open } = await setup();
    const cancelBy = async (act: () => void) => {
      const answer = open();
      await new Promise((r) => setTimeout(r));
      act();
      fixture.detectChanges();
      return answer;
    };

    expect(await cancelBy(() => el.querySelector<HTMLButtonElement>('button.cancel')!.click())).toBeFalse();
    expect(await cancelBy(() => el.querySelector<HTMLButtonElement>('.btn-close')!.click())).toBeFalse();
    expect(await cancelBy(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))).toBeFalse();
    expect(await cancelBy(() => el.querySelector<HTMLElement>('.modal')!.click())).toBeFalse();
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });
});
