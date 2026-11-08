import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const modal = readFileSync(resolve(process.cwd(), 'src/components/Modal.tsx'), 'utf8');
const reseller = readFileSync(resolve(process.cwd(), 'src/components/ResellerPriceListModal.tsx'), 'utf8');

describe('reseller price list responsive UI contract', () => {
  it('uses the full mobile viewport and compact modal spacing', () => {
    expect(modal).toContain('max-h-[calc(100dvh_-_1rem)]');
    expect(modal).toContain('p-3 sm:p-6');
    expect(reseller).toContain('h-[100dvh] max-h-[100dvh] w-full');
  });

  it('keeps settings collapsed behind one mobile summary', () => {
    expect(reseller).toContain('settingsExpanded');
    expect(reseller).toContain('Configuración y asistente');
    expect(reseller).toContain('aria-expanded={settingsExpanded}');
  });

  it('lays out product controls and footer actions within narrow screens', () => {
    expect(reseller).toContain('grid grid-cols-2 gap-3');
    expect(reseller).toContain('grid w-full grid-cols-3 gap-2');
    expect(reseller).toContain('hidden sm:inline');
  });

  it('keeps reseller tabs horizontally scrollable and uses mobile price rows with a bottom editor', () => {
    expect(reseller).toContain('overflow-x-auto border-b border-[var(--line)]');
    expect(reseller).toContain('data-testid="reseller-price-list-mobile"');
    expect(reseller).toContain('Editar precio de ${product.name}');
    expect(reseller).toContain('max-h-[88dvh]');
    expect(reseller).toContain('fixed inset-0 z-[110] flex items-end');
    expect(reseller).toContain('pb-[calc(env(safe-area-inset-bottom)+1rem)]');
    expect(reseller).toContain('useMobileAppChrome({ hideHeader: false, hideBottomNav: hideResellerBottomNavigation })');
    expect(reseller).toContain('createPortal(<div className="reseller-module-page contents">{children}</div>, document.body)');
  });

  it('uses the device PDF viewer on mobile and an in-app fallback elsewhere', () => {
    expect(reseller).toContain('(max-width: 767px), (hover: none) and (pointer: coarse)');
    expect(reseller).toContain("setPdfPreview({ url, fileName: pdf.fileName })");
    expect(reseller).toContain('Vista previa de lista para revendedores');
    expect(reseller).toContain('Abrir PDF');
  });
});
