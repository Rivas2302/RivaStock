import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGroupRules } from './group-discovery.js';

afterEach(() => vi.unstubAllGlobals());

function installRuleSection(text, { visible = true } = {}) {
  const section = {
    innerText: text,
    querySelector: () => null,
    parentElement: null,
  };
  const heading = {
    innerText: 'Reglas del grupo',
    textContent: 'Reglas del grupo',
    closest: () => section,
    parentElement: section,
  };
  vi.stubGlobal('location', { href: 'https://www.facebook.com/groups/demo' });
  vi.stubGlobal('document', { querySelectorAll: () => [heading], body: {} });
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: visible ? 'visible' : 'hidden' }));
  section.querySelector = () => null;
  heading.getClientRects = () => visible ? [{}] : [];
  return { heading, section };
}

describe('Facebook group rules capture', () => {
  it('reads only the visible rules section from the requested group', async () => {
    installRuleSection('Reglas del grupo\nSe permiten ventas locales. No publicar el mismo producto antes de 21 días.');
    await expect(readGroupRules('https://www.facebook.com/groups/demo')).resolves.toBe('Se permiten ventas locales. No publicar el mismo producto antes de 21 días.');
  });

  it('ignores pages outside the requested Facebook group', async () => {
    installRuleSection('Reglas del grupo\nSe permiten ventas.');
    await expect(readGroupRules('https://www.facebook.com/groups/another')).resolves.toBeNull();
  });

  it('does not capture hidden rules sections', async () => {
    installRuleSection('Reglas del grupo\nSe permiten ventas.', { visible: false });
    await expect(readGroupRules('https://www.facebook.com/groups/demo')).resolves.toBeNull();
  });

  it('does not read posts as group rules', async () => {
    const { heading } = installRuleSection('Reglas del grupo\nTexto del post que no corresponde.');
    heading.closest = () => ({ innerText: 'Reglas del grupo\nPost visible', querySelector: selector => selector === '[role="feed"],[role="article"],article' ? {} : null });
    await expect(readGroupRules('https://www.facebook.com/groups/demo')).resolves.toBeNull();
  });
});
