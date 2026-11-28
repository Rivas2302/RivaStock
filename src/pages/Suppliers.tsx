import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSuppliers } from '../hooks/useSuppliers';
import { usePermission } from '../hooks/usePermission';
import { Supplier } from '../types';
import SupplierModal, { SupplierFormData } from '../components/SupplierModal';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Search, Edit2, Trash2, Building2,
  Phone, Mail, Tag, CreditCard, CheckCircle2,
  XCircle, Package, ExternalLink, Facebook, Instagram, MessageCircle, ShoppingBag
} from 'lucide-react';
import { cn } from '../lib/utils';
import '../styles/business-redesign.css';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileSuppliers from '../components/suppliers/MobileSuppliers';
import Modal from '../components/Modal';

export default function Suppliers() {
  const {
    suppliers, loading, createSupplier,
    updateSupplier, deleteSupplier, toggleSupplierActive,
  } = useSuppliers();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const canWrite = usePermission('proveedores', 'write');
  const canDelete = usePermission('proveedores', 'delete');

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [showMissingInfo, setShowMissingInfo] = useState(false);
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
    const missingInfo = suppliers.filter(s => s.isActive && ((!s.phone && !s.email) || !s.catalogUrl || !s.paymentTerms));
    return { active, missingInfo };
  }, [suppliers]);

  const missingFields = (supplier: Supplier) => [
    ...(!supplier.phone && !supplier.email ? ['Teléfono o email'] : []),
    ...(!supplier.catalogUrl ? ['Catálogo'] : []),
    ...(!supplier.paymentTerms ? ['Condición de pago'] : []),
  ];

  const openSupplierPurchases = (supplier: Supplier) => navigate('/compras', { state: { supplierOrderSupplierFilter: supplier.name } });
  const createSupplierPurchase = (supplier: Supplier) => navigate('/compras', { state: { supplierOrderPrefill: { supplierName: supplier.name } } });

  const openNew = () => { setEditingSupplier(null); setIsModalOpen(true); };
  const openEdit = (s: Supplier) => { setEditingSupplier(s); setIsModalOpen(true); };

  const handleSave = async (data: SupplierFormData) => {
    setSaving(true);
    try {
      if (editingSupplier) {
        await updateSupplier(editingSupplier.id, data.name, data.contactName, data.phone,
          data.email, data.address, data.cuit, data.category, data.notes, data.paymentTerms,
          data.catalogUrl, data.facebookUrl, data.instagramUrl, data.minimumOrder, data.deliveryMethod, data.usualLeadTime);
        showMessage('Proveedor actualizado');
      } else {
        await createSupplier(data.name, data.contactName, data.phone, data.email,
          data.address, data.cuit, data.category, data.notes, data.paymentTerms,
          data.catalogUrl, data.facebookUrl, data.instagramUrl, data.minimumOrder, data.deliveryMethod, data.usualLeadTime);
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
    if (isMobile) {
      setSupplierToDelete(s);
      return;
    }
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
    <div className="business-page operational-page space-y-6">
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

      {isMobile ? <MobileSuppliers
        suppliers={suppliers}
        categories={categories}
        activeCount={stats.active}
        needsAttentionCount={stats.missingInfo.length}
        categoryFilter={categoryFilter}
        statusFilter={statusFilter}
        search={search}
        canWrite={canWrite}
        canDelete={canDelete}
        onOpenMissingInfo={() => setShowMissingInfo(true)}
        onOpenDetail={setSelectedSupplier}
        onCategoryFilter={setCategoryFilter}
        onStatusFilter={setStatusFilter}
        onSearch={setSearch}
        onNew={openNew}
        onEdit={openEdit}
        onDelete={handleDelete}
        onToggle={handleToggleActive}
      /> : <>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Proveedores</h2>
          <p className="text-slate-500 dark:text-slate-400">Gestión de proveedores y condiciones de compra</p>
        </div>
        <button onClick={openNew}
          disabled={!canWrite}
          title={!canWrite ? 'Sin permiso' : undefined}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          <Plus size={20} /> Nuevo Proveedor
        </button>
      </div>

      {/* Summary and missing purchase information */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Proveedores activos</p>
          <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{stats.active}</p>
        </div>
        <button type="button" onClick={() => setShowMissingInfo(true)} className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-left shadow-sm transition hover:border-amber-400 dark:border-amber-900/50 dark:bg-amber-950/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Faltan datos de compra</p>
          <p className="mt-1 text-3xl font-black text-amber-800 dark:text-amber-200">{stats.missingInfo.length}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Teléfono o email, catálogo o condición de pago pendientes</p>
        </button>
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
                <th className="px-6 py-4">Catálogo</th>
                <th className="px-6 py-4">Redes</th>
                <th className="px-6 py-4">Estado</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredSuppliers.map(s => (
                <tr key={s.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <button type="button" onClick={() => setSelectedSupplier(s)} className="text-left font-bold text-slate-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-300">{s.name}</button>
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
                    {s.catalogUrl ? (
                      <a
                        href={s.catalogUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir catálogo"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-xs font-semibold hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
                      >
                        <ExternalLink size={12} /> Ver
                      </a>
                    ) : '—'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {s.facebookUrl && (
                        <a
                          href={s.facebookUrl.startsWith('http') ? s.facebookUrl : `https://facebook.com/${s.facebookUrl.replace(/^@/, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Facebook"
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                        >
                          <Facebook size={16} />
                        </a>
                      )}
                      {s.instagramUrl && (
                        <a
                          href={s.instagramUrl.startsWith('http') ? s.instagramUrl : `https://instagram.com/${s.instagramUrl.replace(/^@/, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Instagram"
                          className="text-pink-500 hover:text-pink-700 dark:text-pink-400 dark:hover:text-pink-300 transition-colors"
                        >
                          <Instagram size={16} />
                        </a>
                      )}
                      {!s.facebookUrl && !s.instagramUrl && '—'}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <button onClick={() => handleToggleActive(s)}
                      disabled={!canWrite}
                      title={!canWrite ? 'Sin permiso' : undefined}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
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
                      <button onClick={() => openEdit(s)} disabled={!canWrite} title={!canWrite ? 'Sin permiso' : 'Editar'}
                        className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => handleDelete(s)} disabled={!canDelete} title={!canDelete ? 'Sin permiso' : 'Eliminar'}
                        className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredSuppliers.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    <Package size={32} className="mx-auto mb-2 opacity-30" />
                    {suppliers.length === 0
                      ? 'Todavía no cargaste proveedores. Agregá el primero desde Nuevo Proveedor.'
                      : 'No hay proveedores que coincidan con los filtros aplicados.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>}

      <Modal isOpen={Boolean(selectedSupplier)} onClose={() => setSelectedSupplier(null)} title="Ficha del proveedor" className="max-w-2xl">
        {selectedSupplier && <div className="space-y-5">
          <div><h2 className="text-2xl font-bold text-slate-900 dark:text-white">{selectedSupplier.name}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{selectedSupplier.category || 'Sin categoría'} · {selectedSupplier.isActive ? 'Activo' : 'Inactivo'}</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {selectedSupplier.contactName && <Detail label="Contacto" value={selectedSupplier.contactName} />}
            {selectedSupplier.phone && <Detail label="Teléfono" value={selectedSupplier.phone} />}
            {selectedSupplier.email && <Detail label="Email" value={selectedSupplier.email} />}
            {selectedSupplier.address && <Detail label="Dirección" value={selectedSupplier.address} />}
            {selectedSupplier.cuit && <Detail label="CUIT / CUIL" value={selectedSupplier.cuit} />}
            {selectedSupplier.paymentTerms && <Detail label="Condición de pago" value={selectedSupplier.paymentTerms} />}
            {selectedSupplier.minimumOrder && <Detail label="Pedido mínimo" value={selectedSupplier.minimumOrder} />}
            {selectedSupplier.deliveryMethod && <Detail label="Envío o retiro" value={{shipping:'Envío',pickup:'Retiro',both:'Envío o retiro'}[selectedSupplier.deliveryMethod]} />}
            {selectedSupplier.usualLeadTime && <Detail label="Plazo habitual" value={selectedSupplier.usualLeadTime} />}
            {selectedSupplier.notes && <Detail label="Notas" value={selectedSupplier.notes} />}
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedSupplier.phone && <a href={`https://wa.me/${selectedSupplier.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 font-semibold text-white"><MessageCircle size={17}/> Escribir por WhatsApp</a>}
            {selectedSupplier.catalogUrl && <a href={selectedSupplier.catalogUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 font-semibold dark:border-slate-700"><ExternalLink size={17}/> Abrir catálogo</a>}
            <button type="button" onClick={() => selectedSupplier && openSupplierPurchases(selectedSupplier)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 font-semibold dark:border-slate-700"><Package size={17}/> Ver compras</button>
            {canWrite && <button type="button" onClick={() => selectedSupplier && createSupplierPurchase(selectedSupplier)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 font-semibold text-white"><ShoppingBag size={17}/> Nueva compra</button>}
          </div>
          {canWrite && <button type="button" onClick={() => { const supplier = selectedSupplier; setSelectedSupplier(null); openEdit(supplier); }} className="min-h-11 w-full rounded-xl border border-slate-200 px-4 font-semibold dark:border-slate-700">Editar proveedor</button>}
        </div>}
      </Modal>

      <Modal isOpen={showMissingInfo} onClose={() => setShowMissingInfo(false)} title="Faltan datos de compra" className="max-w-xl">
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Proveedores activos sin teléfono o email, catálogo o condición de pago registrada.</p>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {stats.missingInfo.map(supplier => <button key={supplier.id} type="button" onClick={() => { setShowMissingInfo(false); setSelectedSupplier(supplier); }} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left dark:border-slate-700">
            <span className="font-semibold text-slate-900 dark:text-white">{supplier.name}</span><span className="flex flex-wrap justify-end gap-1">{missingFields(supplier).map(field => <span key={field} className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{field}</span>)}</span>
          </button>)}
          {!stats.missingInfo.length && <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">Todas las fichas activas tienen esos datos cargados.</p>}
        </div>
      </Modal>

      <SupplierModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        editingSupplier={editingSupplier}
        saving={saving}
      />

      <Modal isOpen={Boolean(supplierToDelete)} onClose={() => setSupplierToDelete(null)} title="Eliminar proveedor" className="max-w-md">
        {supplierToDelete && <div className="space-y-4"><p className="text-sm text-slate-600 dark:text-slate-300">¿Querés eliminar "{supplierToDelete.name}"? Si tiene movimientos, el proveedor se desactivará.</p><div className="flex gap-3"><button type="button" onClick={() => setSupplierToDelete(null)} className="min-h-11 flex-1 rounded-xl border border-slate-200 px-4 font-semibold dark:border-slate-700">Cancelar</button><button type="button" onClick={async () => { try { await deleteSupplier(supplierToDelete.id); showMessage(supplierToDelete.isActive ? 'Proveedor eliminado' : 'Proveedor desactivado'); setSupplierToDelete(null); } catch (err) { showMessage(err instanceof Error ? err.message : 'Error al eliminar', 'error'); } }} className="min-h-11 flex-1 rounded-xl bg-rose-600 px-4 font-semibold text-white">Eliminar proveedor</button></div></div>}
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p><p className="mt-1 whitespace-pre-wrap font-medium text-slate-900 dark:text-white">{value}</p></div>;
}
