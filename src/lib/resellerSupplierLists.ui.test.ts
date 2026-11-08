import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const modal = readFileSync(
  resolve(process.cwd(), 'src/components/ResellerPriceListModal.tsx'),
  'utf8',
);
const roundManager = readFileSync(
  resolve(process.cwd(), 'src/components/resellers/SupplierOrderRoundManager.tsx'),
  'utf8',
);

describe('reseller supplier lists UI', () => {
  it('shows the approved flat settings sections with autosave and an owned code dialog', () => {
    expect(modal).toContain('Publicación y acceso');
    expect(modal).toContain('Precios');
    expect(modal).toContain('Compra mínima');
    expect(modal).toContain('Cambiar código');
    expect(modal).toContain('reseller-code-new');
    expect(modal).toContain('reseller-code-repeat');
    expect(modal).toContain('autoComplete="off"');
    expect(modal).toContain('Cambios guardados');
    expect(modal).not.toContain('Precio automático con excepciones');
  });

  it('keeps supplier import controls readable and hides AI reading for store links', () => {
    expect(modal).toContain('aria-pressed:bg-[var(--primary)]');
    expect(modal).toContain("supplierImportSourceType !== 'link'");
    expect(modal).not.toContain('window.confirm');
  });

  it('lets the operator configure and toggle each active supplier list', () => {
    expect(modal).toContain('Listas por proveedor');
    expect(modal).toContain('Crear lista');
    expect(modal).toContain('Habilitar');
    expect(modal).toContain('Pausar');
    expect(modal).toContain('handleToggleSupplierList');
  });

  it('explains the bulk publishing behavior before activation', () => {
    expect(modal).toContain('todos se publican como “Por pedido”');
    expect(modal).toContain('se ocultan sin perder la selección');
  });

  it('imports spreadsheet rows through the connected AI Bridge and supports reviewed bulk creation', () => {
    expect(modal).toContain("supplierImportSourceType === 'spreadsheet' ? '.xlsx,.xls,.csv");
    expect(modal).toContain('Leer lista con IA');
    expect(modal).toContain("'gpt-6-luna'");
    expect(modal).toContain('¿Los precios incluyen IVA?');
    expect(modal).toContain('supplierImportFilteredReadyCount');
    expect(modal).not.toContain('window.confirm');
    expect(modal).toContain('Confirmar productos');
    expect(modal).toContain('Agregar los ${supplierImportFilteredReadyCount} listos');
    expect(modal).toContain('planSupplierImport');
    expect(modal).toContain('supplierImportBatchProgress');
    expect(modal).toContain('initialDraft');
    expect(modal).toContain('recortarla a mano');
    expect(modal).toContain('imageUrl: existing?.imageUrl');
    expect(modal).not.toContain('imageUrl: entry.row.imageUrl');
    expect(modal).toContain('roundingStep');
  });

  it('offers gallery, camera, and a manual crop from the imported screenshot for each reviewed product', () => {
    const picker = readFileSync(resolve(process.cwd(), 'src/components/resellers/SupplierListPhotoPicker.tsx'), 'utf8');
    expect(modal).toContain('<SupplierListPhotoPicker');
    expect(picker).toContain('Elegir foto de galería');
    expect(picker).toContain('Sacar foto para');
    expect(picker).toContain('Recortar captura');
    expect(picker).toContain('Usar recorte');
  });

  it('allows a round to target a named group with its own access code', () => {
    expect(roundManager).toContain('Quiénes lo ven');
    expect(roundManager).toContain('Código del grupo (opcional)');
    expect(roundManager).toContain('Copiar código del grupo');
  });
});
