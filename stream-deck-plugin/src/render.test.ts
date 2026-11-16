import { describe, expect, it } from 'vitest';
import { escapeXml, renderKey, renderStrip } from './render';
import { RED, SKY, type KeyView } from './keys';

const svg = (dataUrl: string) => Buffer.from(dataUrl.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf-8');
const ICON = '<path d="M1 1h2"/>';

describe('drawing a key', () => {
  it('draws a countdown large in its colour, with its icon, its line and its place', () => {
    const view: KeyView = { title: 'T-3d', sub: 'Pixel 9', icon: 'ShieldCheck', accent: RED, big: true, badge: '1/2' };
    const out = svg(renderKey(view, ICON));
    expect(out).toContain('width="144" height="144"');
    expect(out).toContain('>T-3d</text>');
    expect(out).toContain(`fill="${RED}"`);
    expect(out).toContain('>Pixel 9</text>');
    expect(out).toContain('>1/2</text>');
    expect(out).toContain(ICON);
  });

  it('draws a name smaller, with the bar of what is left', () => {
    const out = svg(renderKey({ title: 'Living room television', sub: 'T-55d · Replace', accent: SKY, ratio: 0.25 }, ICON));
    expect(out).toContain('>Living room…</text>');
    expect(out).toMatch(/<rect x="12" y="130" width="30" height="6"/);
  });

  it('has no bar when there is nothing to measure, and dims a key with nothing to act on', () => {
    const out = svg(renderKey({ title: 'thingGLANCE', sub: 'Not running', accent: '#64748b', dim: true }, null));
    expect(out).not.toContain('y="130"');
    expect(out).toContain('fill-opacity="0.45"');
  });

  it('escapes what comes from the app', () => {
    expect(escapeXml('<Tom & "Jerry">')).toBe('&lt;Tom &amp; &quot;Jerry&quot;&gt;');
    expect(svg(renderKey({ title: 'A & B', accent: SKY }, null))).toContain('A &amp; B');
  });

  it('draws the touch strip at its own size', () => {
    const out = svg(renderStrip({ title: 'T-3d', sub: 'Pixel 9', accent: RED, big: true, badge: '1/2' }, ICON));
    expect(out).toContain('width="200" height="100"');
    expect(out).toContain('>T-3d</text>');
    expect(out).toContain('>Pixel 9</text>');
  });
});
