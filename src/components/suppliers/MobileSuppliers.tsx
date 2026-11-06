import { useEffect, useMemo, useState } from 'react';
import { Building2, Facebook, Instagram, Mail, MessageCircle, MoreHorizontal, Package, Phone } from 'lucide-react';
import Modal from '../Modal';
import type { Supplier } from '../../types';

interface MobileSuppliersProps {
  suppliers: Supplier[];
  categories: string[];
  activeCount: number;
  topCategory: string | null;
  categoryFilter: string;
  statusFilter: 'all' | 'active' | 'inactive';
  search: string;
  canWrite: boolean;
  canDelete: boolean;
  onCategoryFilter: (value: string) => void;
  onStatusFilter: (value: 'all' | 'active' | 'inactive') => void;
  onSearch: (value: string) => void;
  onNew: () => void;
  onEdit: (supplier: Supplier) => void;
  onDelete: (supplier: Supplier) => void;
  onToggle: (supplier: Supplier) => void;
}

export default function MobileSuppliers({ suppliers, categories, activeCount, topCategory, categoryFilter, statusFilter, search, canWrite, canDelete, onCategoryFilter, onStatusFilter, onSearch, onNew, onEdit, onDelete, onToggle }: MobileSuppliersProps) {
  const [visibleCount, setVisibleCount] = useState(20);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [moreOpen, setMoreOpen] = useState<string | null>(null);
  useEffect(() => setVisibleCount(20), [categoryFilter, statusFilter, search]);
  const filtered = useMemo(() => suppliers.filter(supplier => {
    const query = search.trim().toLocaleLowerCase();
    const matchSearch = !query || supplier.name.toLocaleLowerCase().includes(query) || supplier.contactName?.toLocaleLowerCase().includes(query) || supplier.email?.toLocaleLowerCase().includes(query) || supplier.phone?.includes(search);
    return matchSearch && (!categoryFilter || supplier.category === categoryFilter) && (statusFilter === 'all' || supplier.isActive === (statusFilter === 'active'));
  }), [suppliers, categoryFilter, statusFilter, search]);

  return <main data-testid="mobile-suppliers" className="business-page mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-8 pt-3 text-slate-900 dark:text-white">
    <header><h1 className="text-2xl font-bold tracking-tight">Proveedores</h1><p className="text-sm text-slate-500 dark:text-slate-400">Contactos y condiciones de compra</p></header>
    <section aria-label="Resumen de proveedores" className="grid grid-cols-2 gap-2.5">
      <Stat label="Activos" value={`${activeCount} de ${suppliers.length}`} />
      <Stat label="Categoría principal" value={topCategory || '—'} />
    </section>
    <button type="button" disabled={!canWrite} onClick={onNew} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 font-bold text-white disabled:opacity-50"><Building2 size={18} /> Nuevo proveedor</button>
    <label className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900"><Package size={18} className="shrink-0 text-slate-500" /><input type="search" aria-label="Buscar proveedor" placeholder="Buscar proveedor o contacto" value={search} onChange={event => onSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
    <section aria-label="Filtrar proveedores" className="flex flex-col gap-2">
      <div className="flex gap-2 overflow-x-auto pb-1"><Chip selected={!categoryFilter} onClick={() => onCategoryFilter('')}>Todas</Chip>{categories.map(category => <Chip key={category} selected={categoryFilter === category} onClick={() => onCategoryFilter(category)}>{category}</Chip>)}</div>
      <div className="flex gap-2 overflow-x-auto pb-1"><Chip selected={statusFilter === 'active'} onClick={() => onStatusFilter(statusFilter === 'active' ? 'all' : 'active')}>Solo activos</Chip>{statusFilter === 'inactive' && <Chip selected onClick={() => onStatusFilter('all')}>Solo inactivos</Chip>}</div>
    </section>
    <section aria-label="Lista de proveedores" className="flex flex-col gap-3">
      {filtered.slice(0, visibleCount).map(supplier => {
        const phone = supplier.phone?.replace(/[^\d+]/g, '');
        const catalog = supplier.catalogUrl || supplier.instagramUrl || supplier.facebookUrl;
        return <article key={supplier.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-2"><button type="button" onClick={() => setSelected(supplier)} className="min-w-0 flex-1 text-left"><span className="block truncate text-base font-bold">{supplier.name}</span>{supplier.contactName && <span className="mt-0.5 block truncate text-sm text-slate-600 dark:text-slate-300">Contacto: {supplier.contactName}</span>}</button><button type="button" aria-label={`Más opciones para ${supplier.name}`} aria-expanded={moreOpen === supplier.id} onClick={() => setMoreOpen(moreOpen === supplier.id ? null : supplier.id)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 dark:border-slate-700"><MoreHorizontal size={18} /></button></div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><span className="rounded-full bg-indigo-100 px-2.5 py-1 font-semibold text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">{supplier.category || 'Sin categoría'}</span><span className={`rounded-full px-2.5 py-1 font-semibold ${supplier.isActive ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{supplier.isActive ? 'Activo' : 'Inactivo'}</span>{supplier.paymentTerms && <span>{supplier.paymentTerms}</span>}</div>
          <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            {phone && <a href={`https://wa.me/${phone.replace(/\D/g, '')}`} aria-label={`WhatsApp de ${supplier.name}`} className="flex min-h-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"><MessageCircle size={18} /></a>}
            {phone && <a href={`tel:${phone}`} aria-label={`Llamar a ${supplier.name}`} className="flex min-h-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"><Phone size={18} /></a>}
            {catalog && <a href={catalog} target="_blank" rel="noopener noreferrer" aria-label={`Abrir catálogo de ${supplier.name}`} className="flex min-h-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"><Package size={18} /></a>}
          </div>
          {moreOpen === supplier.id && <div role="menu" className="flex flex-col gap-1 border-t border-slate-100 pt-2 dark:border-slate-800">
            {canWrite && <button role="menuitem" type="button" onClick={() => { setMoreOpen(null); onEdit(supplier); }} className="min-h-11 rounded-lg px-3 text-left text-sm font-medium">Editar proveedor</button>}
            {canWrite && <button role="menuitem" type="button" onClick={() => { setMoreOpen(null); onToggle(supplier); }} className="min-h-11 rounded-lg px-3 text-left text-sm font-medium">{supplier.isActive ? 'Desactivar' : 'Activar'}</button>}
            {canDelete && <button role="menuitem" type="button" onClick={() => { setMoreOpen(null); onDelete(supplier); }} className="min-h-11 rounded-lg px-3 text-left text-sm font-medium text-rose-700 dark:text-rose-300">Eliminar proveedor</button>}
          </div>}
        </article>;
      })}
      {filtered.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">No hay proveedores que coincidan con los filtros.</p>}
      {filtered.length > visibleCount && <button type="button" onClick={() => setVisibleCount(value => value + 20)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-300">Ver más proveedores</button>}
    </section>

    <Modal isOpen={Boolean(selected)} onClose={() => setSelected(null)} title="Detalle del proveedor" className="max-w-xl">
      {selected && <div className="space-y-3 text-sm">
        <h2 className="text-xl font-bold">{selected.name}</h2>
        {selected.contactName && <p>Contacto: {selected.contactName}</p>}{selected.phone && <p>Teléfono: {selected.phone}</p>}{selected.email && <p>Email: <a href={`mailto:${selected.email}`} className="text-indigo-600 underline dark:text-indigo-300">{selected.email}</a></p>}{selected.address && <p>Dirección: {selected.address}</p>}{selected.cuit && <p>CUIT: {selected.cuit}</p>}{selected.paymentTerms && <p>Condición: {selected.paymentTerms}</p>}{selected.notes && <p className="whitespace-pre-wrap">{selected.notes}</p>}
        <div className="flex flex-wrap gap-3">{selected.instagramUrl && <a href={selected.instagramUrl} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700"><Instagram size={17} /> Instagram</a>}{selected.facebookUrl && <a href={selected.facebookUrl} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700"><Facebook size={17} /> Facebook</a>}{selected.catalogUrl && <a href={selected.catalogUrl} target="_blank" rel="noopener noreferrer" aria-label="Catálogo" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700"><Package size={17} /> Catálogo</a>}{selected.email && <a href={`mailto:${selected.email}`} aria-label="Correo" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700"><Mail size={17} /> Email</a>}</div>
        {canWrite && <button type="button" onClick={() => { setSelected(null); onEdit(selected); }} className="min-h-11 w-full rounded-xl bg-indigo-600 px-4 font-semibold text-white">Editar proveedor</button>}
        {canWrite && <button type="button" onClick={() => { setSelected(null); onToggle(selected); }} className="min-h-11 w-full rounded-xl border border-slate-200 px-4 font-semibold dark:border-slate-700">{selected.isActive ? 'Desactivar proveedor' : 'Activar proveedor'}</button>}
      </div>}
    </Modal>
  </main>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="flex min-h-[74px] min-w-0 flex-col justify-center gap-1 rounded-xl bg-slate-100 px-3 dark:bg-slate-800"><span className="text-xs text-slate-500 dark:text-slate-400">{label}</span><strong className="truncate text-base font-bold">{value}</strong></div>;
}

function Chip({ children, selected, onClick }: { children: string; selected: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>{children}</button>;
}
