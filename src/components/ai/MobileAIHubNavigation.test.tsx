// @vitest-environment jsdom
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import MobileAIHubNavigation from './MobileAIHubNavigation';
import { useMobileAppChrome, type MobileAppChromeState } from '../../hooks/useMobileAppChrome';

function MobileChromeOutlet() {
  const [, setMobileChrome] = useState<MobileAppChromeState>({ hideHeader: false, hideBottomNav: false });
  return <Outlet context={{ setMobileChrome }}/>;
}

describe('mobile AI hub navigation', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (ui: ReactElement) => {
    await act(async () => { root.render(ui); });
  };

  const renderWithChromeOutlet = async (child: ReactElement) => render(
    <MemoryRouter initialEntries={['/']}>
      <Routes><Route path="/" element={<MobileChromeOutlet/>}><Route index element={child}/></Route></Routes>
    </MemoryRouter>,
  );

  const click = async (button: HTMLButtonElement | null) => {
    if (!button) throw new Error('Expected button was not found.');
    await act(async () => { button.focus(); button.click(); });
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
  });

  it('shows the two primary sections and opens an accessible More sheet', async () => {
    const onNavigate = vi.fn();
    await renderWithChromeOutlet(<MobileAIHubNavigation view="chats" bridgeState="idle" isOwner onNavigate={onNavigate}/>);
    expect(host.querySelector('h1')?.textContent).toBe('Asistente IA');
    expect(host.textContent).toContain('PC conectada');
    expect(host.querySelector('nav[aria-label="Secciones de IA"]')?.textContent).toContain('Chats');
    expect(host.querySelector('nav[aria-label="Secciones de IA"]')?.textContent).toContain('Tareas');

    await click(host.querySelector('button[aria-haspopup="dialog"]'));
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.textContent).toContain('Conocimientos');
    expect(dialog?.textContent).toContain('Skills');
    expect(dialog?.textContent).toContain('Memoria');
    expect(dialog?.textContent).toContain('Conexión');
    expect(dialog?.textContent).toContain('Acciones');
    expect(document.activeElement).toBe(host.querySelector('button[aria-label="Cerrar más secciones"]'));
  });

  it('closes with Escape, restores focus, and hides owner actions for a collaborator', async () => {
    await renderWithChromeOutlet(<MobileAIHubNavigation view="tasks" bridgeState="offline" isOwner={false} onNavigate={vi.fn()}/>);
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    await click(trigger);
    expect(host.querySelector('[role="dialog"]')?.textContent).not.toContain('Acciones');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(host.textContent).toContain('PC desconectada');
  });

  it('sends primary navigation choices to the hub', async () => {
    const onNavigate = vi.fn();
    await renderWithChromeOutlet(<MobileAIHubNavigation view="chats" bridgeState={null} isOwner onNavigate={onNavigate}/>);
    await click(Array.from(host.querySelectorAll('nav[aria-label="Secciones de IA"] button')).find((button) => button.textContent?.includes('Tareas')) as HTMLButtonElement);
    expect(onNavigate).toHaveBeenCalledWith('tasks');
  });

  it('starts a new chat from the header action on the chat list', async () => {
    const onNewChat = vi.fn();
    await renderWithChromeOutlet(<MobileAIHubNavigation view="chats" bridgeState="idle" isOwner canWrite onNewChat={onNewChat} onNavigate={vi.fn()}/>);
    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Nuevo chat')) ?? null);
    expect(onNewChat).toHaveBeenCalledOnce();
  });
});

describe('mobile app chrome controller', () => {
  let host: HTMLDivElement;
  let root: Root;

  function ChromeLayout() {
    const [chrome, setChrome] = useState<MobileAppChromeState>({ hideHeader: false, hideBottomNav: false });
    return <><output data-testid="chrome-state">{`${chrome.hideHeader}:${chrome.hideBottomNav}`}</output><Outlet context={{ setMobileChrome: setChrome }}/></>;
  }

  function ChromeProbe() {
    useMobileAppChrome({ hideHeader: true, hideBottomNav: true });
    return null;
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
  });

  it('hides the app bottom bar in full-screen chat mode', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const ui = <MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<ChromeLayout/>}><Route index element={<MobileAIHubNavigation view="chats" bridgeState="idle" isOwner fullScreen onNavigate={vi.fn()}/>}/></Route></Routes></MemoryRouter>;
    await act(async () => { root.render(ui); });
    expect(host.querySelector('[data-testid="chrome-state"]')?.textContent).toBe('true:true');
    expect(host.querySelector('header')).toBeNull();
  });

  it('hides mobile chrome only below the 1024px desktop breakpoint and resets on unmount', async () => {
    let matches = false;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const media = {
      media: '(max-width: 1023px)', matches,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    } as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => media));

    const ui = <MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<ChromeLayout/>}><Route index element={<ChromeProbe/>}/></Route></Routes></MemoryRouter>;
    await act(async () => { root.render(ui); });
    expect(host.textContent).toBe('false:false');

    matches = true;
    Object.defineProperty(media, 'matches', { configurable: true, value: true });
    await act(async () => { listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent)); });
    expect(host.textContent).toBe('true:true');

    matches = false;
    Object.defineProperty(media, 'matches', { configurable: true, value: false });
    await act(async () => { listeners.forEach((listener) => listener({ matches: false } as MediaQueryListEvent)); });
    expect(host.textContent).toBe('false:false');
  });
});
