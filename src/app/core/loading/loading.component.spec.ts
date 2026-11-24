import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoadingComponent } from './loading.component';
import { SpinnerComponent } from './spinner.component';

@Component({
  imports: [LoadingComponent, SpinnerComponent],
  template: `
    <app-loading text="Loading plants…" />
    <button aria-busy="true" disabled><app-spinner class="me-1" />Save</button>
  `,
})
class HostComponent {}

describe('LoadingComponent and SpinnerComponent', () => {
  it('tell screen readers what is loading, while the spinners stay decorative', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const loading = el.querySelector('app-loading')!;
    expect(loading.getAttribute('role')).toBe('status');
    expect(loading.textContent!.trim()).toBe('Loading plants…');
    for (const spinner of Array.from(el.querySelectorAll('.spinner-border'))) {
      expect(spinner.getAttribute('aria-hidden')).toBe('true');
    }
    expect(el.querySelector('button')!.textContent!.trim()).toBe('Save');
  });
});
