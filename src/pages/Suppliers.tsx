import React, { useState, useMemo } from 'react';
import { useSuppliers } from '../hooks/useSuppliers';
import { Supplier } from '../types';
import SupplierModal, { SupplierFormData } from '../components/SupplierModal';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Search, Edit2, Trash2, Building2,
  Phone, Mail, Tag, CreditCard, CheckCircle2,
  XCircle, Package
} from 'lucide-react';
import { cn } from '../lib/utils';

export default function Suppliers() {
  const {
    suppliers, loading, createSupplier,
    updateSupplier, deleteSupplier, toggleSupplierActive,
  } = useSuppliers();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const categories = useMemo(() => {
    const cats = new Set<string>();
    suppliers.forEach(s => { if (s.category) cats.add(s.category); });
    return Array.from(cats).sort();
  }, [suppliers]);

  const filteredSuppliers = useMemo(() => {
    let result = suppliers;
    if (statusFilter === 'active') result = result.filter(s => s.isActive);
    else if (statusFilter === 'inactive') result = result.filter(s => !s.isActive);
    if (categoryFilter) result = result.filter(s => s.category === categoryFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.contactName?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q) ||
        s.cuit?.includes(q) ||
        s.phone?.includes(q)
      );
    }
    return result;
  }, [suppliers, search, categoryFilter, statusFilter]);

  const stats = useMemo(() => {
    const active = suppliers.filter(s => s.isActive).length;
    const byCategory: Record<string, number> = {};
    suppliers.filter(s => s.isActive).forEach(s => {
      if (s.category) byCategory[s.category] = (byCategory[s.category] || 0) + 1;
    });
    const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
    return { total: suppliers.length, active, topCategory: topCategory ? topCategory[0] : null };
  }, [suppliers]);

  const openNew = () => { setEditingSupplier(null); setIsModalOpen(true); };
  const openEdit = (s: Supplier) => { setEditingSupplier(s); setIsModalOpen(true); };

  const handleSave = async (data: SupplierFormData) => {
    setSaving(true);
    try {
      if (editingSupplier) {
        await updateSupplier(editingSupplier.id, data.name, data.contactName, data.phone,
          data.email, data.address, data.cuit, data.category, data.notes, data.paymentTerms);
        showMessage('Proveedor actualizado');
      } else {
        await createSupplier(data.name, data.contactName, data.phone, data.email,
          data.address, data.cuit, data.category, data.notes, data.paymentTerms);
        showMessage('Proveedor creado');
      }
      setIsModalOpen(false);
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Error al guardar', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s: Supplier) => {
    if (!confirm(`¿Eliminar "${s.name}"?`)) return;
    try {
      await deleteSupplier(s.id);
      showMessage(s.isActive ? 'Proveedor eliminado' : 'Proveedor desactivado');
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Error al eliminar', 'error');
    }
  };

  const handleToggleActive = async (s: Supplier) => {
    try {
      await toggleSupplierActive(s.id);
      showMessage(s.isActive ? 'Proveedor desactivado' : 'Proveedor activado');
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              'fixed top-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-xl z-[200] font-bold text-sm',
              message.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
            )}
          >
            {message.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Proveedores</h2>
          <p className="text-slate-500 dark:text-slate-400">Gestión de proveedores y condiciones de compra</p>
        </div>
        <button onClick={openNew}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all">
          <Plus size={20} /> Nuevo Proveedor
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold tracking-wide mb-1">Total</p>
          <p className="text-3xl font-black text-slate-900 dark:text-white">{stats.total}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold tracking-wide mb-1">Activos</p>
          <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{stats.active}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold tracking-wide mb-1">Categoría Principal</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{stats.topCategory ?? '—'}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input type="text" placeholder="Buscar por nombre, contacto, email o CUIT..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white text-sm">
          <option value="">Todas las categorías</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white text-sm">
          <option value="all">Todos</option>
          <option value="active">Solo activos</option>
          <option value="inactive">Solo inactivos</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
              <tr>
                <th className="px-6 py-4"><Building2 size={14} className="inline mr-1" />Nombre</th>
                <th className="px-6 py-4">Contacto</th>
                <th className="px-6 py-4"><Phone size={14} className="inline mr-1" />Teléfono</th>
                <th className="px-6 py-4"><Mail size={14} className="inline mr-1" />Email</th>
                <th className="px-6 py-4"><Tag size={14} className="inline mr-1" />Categoría</th>
                <th className="px-6 py-4"><CreditCard size={14} className="inline mr-1" />Condición</th>
                <th className="px-6 py-4">Estado</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredSuppliers.map(s => (
                <tr key={s.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-bold text-slate-900 dark:text-white">{s.name}</p>
                    {s.cuit && <p className="text-xs text-slate-400">{s.cuit}</p>}
                  </td>
                  <td className="px-6 py-4 text-slate-600 dark:text-slate-400">{s.contactName || '—'}</td>
                  <td className="px-6 py-4 text-slate-600 dark:text-slate-400">{s.phone || '—'}</td>
                  <td className="px-6 py-4 text-slate-600 dark:text-slate-400">{s.email || '—'}</td>
                  <td className="px-6 py-4">
                    {s.category ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-xs font-semibold">
                        <Tag size={10} /> {s.category}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-6 py-4 text-slate-600 dark:text-slate-400 text-xs">{s.paymentTerms || '—'}</td>
                  <td className="px-6 py-4">
                    <button onClick={() => handleToggleActive(s)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold transition-colors">
                      {s.isActive ? (
                        <span className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 size={12} /> Activo
                        </span>
                      ) : (
                        <span className="bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 flex items-center gap-1">
                          <XCircle size={12} /> Inactivo
                        </span>
                      )}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(s)} title="Editar"
                        className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => handleDelete(s)} title="Eliminar"
                        className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredSuppliers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    <Package size={32} className="mx-auto mb-2 opacity-30" />
                    No se encontraron proveedores
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SupplierModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        editingSupplier={editingSupplier}
        saving={saving}
      />
    </div>
  );
}