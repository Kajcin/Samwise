import { TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';
import { ICONS } from './icons.generated';

describe('IconComponent', () => {
  async function render(name: string, label?: string) {
    const fixture = TestBed.createComponent(IconComponent);
    fixture.componentRef.setInput('name', name);
    if (label) fixture.componentRef.setInput('label', label);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('svg') as SVGSVGElement;
  }

  it('draws the icon as SVG paths in the current text colour, at text size', async () => {
    const svg = await render('scissors');

    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('width')).toBe('1em');
    const paths = Array.from(svg.querySelectorAll('path'));
    expect(paths.map((p) => p.getAttribute('d'))).toEqual(ICONS.scissors.map((p) => p.d));
    expect(paths[0].namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('keeps fill rules where the icon has them', async () => {
    const withRule = (Object.keys(ICONS) as (keyof typeof ICONS)[]).find((n) =>
      ICONS[n].some((p) => 'fillRule' in p),
    );
    if (!withRule) return; // none of the bundled icons uses one
    const svg = await render(withRule);

    expect(Array.from(svg.querySelectorAll('path')).some((p) => p.getAttribute('fill-rule'))).toBeTrue();
  });

  it('is hidden from screen readers unless it has a label', async () => {
    expect((await render('trash')).getAttribute('aria-hidden')).toBe('true');

    const labelled = await render('trash', 'Remove');
    expect(labelled.getAttribute('aria-hidden')).toBeNull();
    expect(labelled.getAttribute('role')).toBe('img');
    expect(labelled.getAttribute('aria-label')).toBe('Remove');
  });
});
