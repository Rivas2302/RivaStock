import React, { useEffect } from 'react';
import Modal from './Modal';
import { Facebook, Instagram } from 'lucide-react';
import { Supplier } from '../types';
import '../styles/business-redesign.css';

interface SupplierModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: SupplierFormData) => Promise<void>;
  editingSupplier?: Supplier | null;
  saving?: boolean;
}

export interface SupplierFormData {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  cuit?: string;
  category?: string;
  notes?: string;
  paymentTerms?: string;
  catalogUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
}

const CATEGORIES = ['Insumos', 'Tecnología', 'Servicios', 'Materias Primas', 'Transporte', 'Otros'];

export default function SupplierModal({
  isOpen, onClose, onSave, editingSupplier, saving = false,
}: SupplierModalProps) {
  const [name, setName] = React.useState('');
  const [contactName, setContactName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [cuit, setCuit] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [paymentTerms, setPaymentTerms] = React.useState('');
  const [catalogUrl, setCatalogUrl] = React.useState('');
const [facebookUrl, setFacebookUrl] = React.useState('');
const [instagramUrl, setInstagramUrl] = React.useState('');

  useEffect(() => {
    if (editingSupplier) {
      setName(editingSupplier.name || '');
      setContactName(editingSupplier.contactName || '');
      setPhone(editingSupplier.phone || '');
      setEmail(editingSupplier.email || '');
      setAddress(editingSupplier.address || '');
      setCuit(editingSupplier.cuit || '');
      setCategory(editingSupplier.category || '');
      setNotes(editingSupplier.notes || '');
      setPaymentTerms(editingSupplier.paymentTerms || '');
      setCatalogUrl(editingSupplier.catalogUrl || '');
      setFacebookUrl(editingSupplier.facebookUrl || '');
      setInstagramUrl(editingSupplier.instagramUrl || '');
    } else {
      setName(''); setContactName(''); setPhone('');
      setEmail(''); setAddress(''); setCuit('');
      setCategory(''); setNotes(''); setPaymentTerms('');
      setCatalogUrl(''); setFacebookUrl(''); setInstagramUrl('');
    }
  }, [editingSupplier, isOpen]);

  const SOCIAL_PATTERN = /^(https?:\/\/.+|@[\w.]+)$/;

  function validateSocial(value: string): boolean {
    if (!value) return true;
    return SOCIAL_PATTERN.test(value);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!validateSocial(facebookUrl.trim())) {
      alert('Facebook: ingresá una URL válida (https://...) o un @usuario');
      return;
    }
    if (!validateSocial(instagramUrl.trim())) {
      alert('Instagram: ingresá una URL válida (https://...) o un @usuario');
      return;
    }
    await onSave({
      name: name.trim(),
      contactName: contactName.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      cuit: cuit.trim() || undefined,
      category: category.trim() || undefined,
      notes: notes.trim() || undefined,
      paymentTerms: paymentTerms.trim() || undefined,
      catalogUrl: catalogUrl.trim() || undefined,
      facebookUrl: facebookUrl.trim() || undefined,
      instagramUrl: instagramUrl.trim() || undefined,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingSupplier ? 'Editar Proveedor' : 'Nuevo Proveedor'}
      className="max-w-lg supplier-modal"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Nombre / Razón Social *
          </label>
          <input
            type="text" required value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nombre del proveedor"
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Persona de Contacto</label>
            <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Juan Pérez"
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Teléfono</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+54 11 1234-5678"
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="contacto@empresa.com"
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Dirección</label>
          <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="Calle 123, Ciudad"
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">CUIT / CUIL</label>
            <input type="text" value={cuit} onChange={e => setCuit(e.target.value)} placeholder="XX-XXXXXXXX-X"
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Categoría</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white">
              <option value="">Seleccionar...</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Condición de Pago</label>
          <input type="text" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} placeholder="30 días, Contado, etc."
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">URL del Catálogo</label>
          <input type="url" value={catalogUrl} onChange={e => setCatalogUrl(e.target.value)} placeholder="https://..."
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              <Facebook size={13} className="text-blue-600" /> Facebook
            </label>
            <input
              type="text"
              value={facebookUrl}
              onChange={e => setFacebookUrl(e.target.value)}
              placeholder="https://facebook.com/empresa o @empresa"
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white text-sm"
            />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              <Instagram size={13} className="text-pink-500" /> Instagram
            </label>
            <input
              type="text"
              value={instagramUrl}
              onChange={e => setInstagramUrl(e.target.value)}
              placeholder="https://instagram.com/empresa o @empresa"
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Notas / Observaciones</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notas adicionales..."
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white resize-none text-sm" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={saving || !name.trim()}
            className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-60">
            {saving ? 'Guardando...' : editingSupplier ? 'Guardar Cambios' : 'Crear Proveedor'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
