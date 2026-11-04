import { useState } from 'react';
import type { Product } from '../../types';
import Modal from '../Modal';

interface Props {
  product: Product;
  onClose: () => void;
  onConfirm: (product: Product) => Promise<boolean>;
}

export default function ProductDeleteConfirmation({ product, onClose, onConfirm }: Props) {
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (await onConfirm(product)) onClose();
    } finally {
      setSaving(false);
    }
  };

  return <Modal isOpen onClose={() => { if (!saving) onClose(); }} title="Eliminar producto" className="max-w-md">
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">¿Eliminar <strong>{product.name}</strong>? Se borra el producto y sus fotos. No se puede deshacer.</p>
      <div className="flex gap-3">
        <button type="button" onClick={onClose} disabled={saving} className="min-h-11 flex-1 rounded-xl border border-slate-200 font-semibold disabled:opacity-50 dark:border-slate-700">Cancelar</button>
        <button type="button" onClick={() => void confirm()} disabled={saving} className="min-h-11 flex-1 rounded-xl bg-rose-600 font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{saving ? 'Eliminando…' : 'Eliminar'}</button>
      </div>
    </div>
  </Modal>;
}
