import { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { CashFlowEntry } from '../types';
import { formatCurrency, cn, formatDate, todayString } from '../lib/utils';
import {
  Plus,
  Search,
  Filter,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Edit2,
  Trash2
} from 'lucide-react';
import Modal from '../components/Modal';
import { motion } from 'motion/react';

export default function CashFlow() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<CashFlowEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CashFlowEntry | null>(null);
  const [modalType, setModalType] = useState<'Ingreso' | 'Gasto'>('Ingreso');
  const [formData, setFormData] = useState<Partial<CashFlowEntry>>({
    date: todayString(),
    description: '',
    category: 'Otros',
    amount: 0,
    paymentMethod: 'Efectivo',
    status: 'Pagado',
    notes: ''
  });

  const resetForm = () => {
    setFormData({
      date: todayString(),
      description: '',
      category: 'Otros',
      amount: 0,
      paymentMethod: 'Efectivo',
      status: 'Pagado',
      notes: ''
    });
    setEditingEntry(null);
  };

  const isSaleManagedEntry = (entry: CashFlowEntry) => entry.source === 'Venta';

  const handleToggleStatus = async (entry: CashFlowEntry) => {
    if (!user) return;
    if (isSaleManagedEntry(entry)) {
      alert('Los movimientos generados por ventas se gestionan desde la pantalla de Ventas o Cuenta Corriente.');
      return;
    }
    const newStatus = entry.status === 'Pagado' ? 'Pendiente' : 'Pagado';
    await db.update('cash_flow', entry.id, { status: newStatus });
    fetchData();
  };

  const fetchData = async () => {
    if (!user) return;
    const cf = await db.list<CashFlowEntry>('cash_flow', user.uid);
    setEntries(cf.sort((a, b) => {
      const dc = b.date.localeCompare(a.date);
      if (dc !== 0) return dc;
      return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
    }));
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const handleDelete = async (id: string) => {
    const entry = entries.find(item => item.id === id);
    if (entry && isSaleManagedEntry(entry)) {
      alert('Los movimientos generados por ventas se eliminan desde la venta o el cobro que los originó.');
      return;
    }
    if (!confirm('¿Estás seguro de eliminar este registro?')) return;
    await db.delete('cash_flow', id);
    fetchData();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || saving) return;
    setSaving(true);

    try {
      const entryData = {
        ...formData,
        type: modalType,
        // Preserve original source when editing; set default for new entries
        source: editingEntry ? editingEntry.source : (modalType === 'Ingreso' ? 'Manual' : 'Gasto'),
        ownerUid: user.uid
      } as CashFlowEntry;

      if (editingEntry) {
        if (isSaleManagedEntry(editingEntry)) {
          alert('Los movimientos generados por ventas se editan desde el flujo que los originó.');
          return;
        }
        await db.update('cash_flow', editingEntry.id, entryData);
      } else {
        // Idempotency: reject duplicate within 5 seconds (same type/amount/description/date)
        const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
        const potentialDuplicate = entries.find(en =>
          en.type === modalType &&
          en.amount === (formData.amount || 0) &&
          en.description === formData.description &&
          en.date === formData.date &&
          en.createdAt && en.createdAt > fiveSecondsAgo
        );
        if (potentialDuplicate) {
          alert('Se detectó un registro idéntico creado hace menos de 5 segundos. Operación cancelada para evitar duplicados.');
          return;
        }

        await db.create('cash_flow', {
          ...entryData,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString()
        });
      }

      setIsModalOpen(false);
      resetForm();
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  // Calculations
  const totalCollected = entries.filter(e => e.type === 'Ingreso' && e.status === 'Pagado').reduce((acc, e) => acc + e.amount, 0);
  const totalPendingIncome = entries.filter(e => e.type === 'Ingreso' && e.status === 'Pendiente').reduce((acc, e) => acc + e.amount, 0);
  const totalExpenses = entries.filter(e => e.type === 'Gasto' && e.status === 'Pagado').reduce((acc, e) => acc + e.amount, 0);
  const totalPendingExpenses = entries.filter(e => e.type === 'Gasto' && e.status === 'Pendiente').reduce((acc, e) => acc + e.amount, 0);
  
  const netBalance = totalCollected - totalExpenses;

  const cashIncome = entries.filter(e => e.type === 'Ingreso' && e.status === 'Pagado' && e.paymentMethod === 'Efectivo').reduce((acc, e) => acc + e.amount, 0);
  const cashExpenses = entries.filter(e => e.type === 'Gasto' && e.status === 'Pagado' && e.paymentMethod === 'Efectivo').reduce((acc, e) => acc + e.amount, 0);
  const availableCash = cashIncome - cashExpenses;

  const bankIncome = entries.filter(e => e.type === 'Ingreso' && e.status === 'Pagado' && e.paymentMethod === 'Transferencia').reduce((acc, e) => acc + e.amount, 0);
  const bankExpenses = entries.filter(e => e.type === 'Gasto' && e.status === 'Pagado' && e.paymentMethod === 'Transferencia').reduce((acc, e) => acc + e.amount, 0);
  const availableBank = bankIncome - bankExpenses;

  const filteredEntries = entries.filter(e => {
    const matchesSearch = e.description.toLowerCase().includes(search.toLowerCase()) || e.category.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === 'all' || 
      (typeFilter === 'ingresos' && e.type === 'Ingreso') || 
      (typeFilter === 'gastos' && e.type === 'Gasto') ||
      (typeFilter === 'pendientes' && e.status === 'Pendiente');
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Flujo de Caja</h2>
          <p className="text-slate-500 dark:text-slate-400">Control de ingresos y egresos</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { resetForm(); setModalType('Ingreso'); setIsModalOpen(true); }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all"
          >
            <Plus size={20} />
            Ingreso Manual
          </button>
          <button
            onClick={() => { resetForm(); setModalType('Gasto'); setIsModalOpen(true); }}
            className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-rose-500/20 transition-all"
          >
            <Plus size={20} />
            Gasto
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">Balance Neto</p>
            <div className="p-2 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 rounded-xl">
              <Wallet size={20} />
            </div>
          </div>
          <p className={cn(
            "text-4xl font-black",
            netBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
          )}>
            {formatCurrency(netBalance)}
          </p>
          <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-slate-100 dark:border-slate-800">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Efectivo</p>
              <p className="text-lg font-bold text-slate-900 dark:text-white">{formatCurrency(availableCash)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Banco/Transf.</p>
              <p className="text-lg font-bold text-slate-900 dark:text-white">{formatCurrency(availableBank)}</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 md:space-y-0">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-slate-400 uppercase">Cobrado</p>
              <ArrowUpRight size={16} className="text-emerald-500" />
            </div>
            <p className="text-xl font-bold text-slate-900 dark:text-white">{formatCurrency(totalCollected)}</p>
            <p className="text-[10px] text-slate-400 mt-1">Pendiente: {formatCurrency(totalPendingIncome)}</p>
          </div>
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-slate-400 uppercase">Gastos</p>
              <ArrowDownRight size={16} className="text-rose-500" />
            </div>
            <p className="text-xl font-bold text-slate-900 dark:text-white">{formatCurrency(totalExpenses)}</p>
            <p className="text-[10px] text-slate-400 mt-1">Pendiente: {formatCurrency(totalPendingExpenses)}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder="Buscar por descripción o categoría..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
          />
        </div>
        <div className="flex gap-2">
          {['all', 'ingresos', 'gastos', 'pendientes'].map((filter) => (
            <button
              key={filter}
              onClick={() => setTypeFilter(filter)}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-semibold transition-all border",
                typeFilter === filter
                  ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                  : "bg-white border-slate-200 text-slate-600 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400"
              )}
            >
              {filter === 'all' ? 'Todos' : filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Unified List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
              <tr>
                <th className="px-6 py-4">Fecha</th>
                <th className="px-6 py-4">Descripción</th>
                <th className="px-6 py-4">Categoría</th>
                <th className="px-6 py-4">Método</th>
                <th className="px-6 py-4">Monto</th>
                <th className="px-6 py-4">Estado</th>
                <th className="px-6 py-4">Origen</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredEntries.map((e) => (
                <tr key={e.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4 dark:text-slate-300 whitespace-nowrap">{formatDate(e.date)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "p-1.5 rounded-lg",
                        e.type === 'Ingreso' ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"
                      )}>
                        {e.type === 'Ingreso' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                      </div>
                      <span className="font-bold text-slate-900 dark:text-white">{e.description}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 dark:text-slate-300">{e.category}</td>
                  <td className="px-6 py-4 dark:text-slate-300">{e.paymentMethod}</td>
                  <td className={cn(
                    "px-6 py-4 font-black",
                    e.type === 'Ingreso' ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                  )}>
                    {e.type === 'Ingreso' ? '+' : '-'}{formatCurrency(e.amount)}
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleToggleStatus(e)}
                      disabled={isSaleManagedEntry(e)}
                      title={isSaleManagedEntry(e)
                        ? 'Gestionado desde Ventas o Cuenta Corriente'
                        : e.status === 'Pagado'
                          ? 'Click para marcar como Pendiente'
                          : 'Click para marcar como Pagado'}
                      className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase transition-opacity",
                        isSaleManagedEntry(e) ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:opacity-70",
                        e.status === 'Pagado' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      )}
                    >
                      {e.status}
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-[10px] bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 px-1.5 py-0.5 rounded uppercase font-bold">
                      {e.source}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          if (isSaleManagedEntry(e)) return;
                          setEditingEntry(e);
                          setModalType(e.type);
                          setFormData(e);
                          setIsModalOpen(true);
                        }}
                        disabled={isSaleManagedEntry(e)}
                        className={cn(
                          "p-2 transition-colors",
                          isSaleManagedEntry(e)
                            ? "text-slate-300 dark:text-slate-700 cursor-not-allowed"
                            : "text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                        )}
                        title={isSaleManagedEntry(e) ? 'Gestionado desde Ventas o Cuenta Corriente' : 'Editar'}
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(e.id)}
                        disabled={isSaleManagedEntry(e)}
                        className={cn(
                          "p-2 transition-colors",
                          isSaleManagedEntry(e)
                            ? "text-slate-300 dark:text-slate-700 cursor-not-allowed"
                            : "text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                        )}
                        title={isSaleManagedEntry(e) ? 'Gestionado desde Ventas o Cuenta Corriente' : 'Eliminar'}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredEntries.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    No hay movimientos registrados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={editingEntry
          ? `Editar ${modalType}`
          : modalType === 'Ingreso' ? 'Agregar Ingreso Manual' : 'Registrar Gasto'}
      >
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Fecha</label>
              <input 
                type="date"
                required
                value={formData.date}
                onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Monto</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                <input 
                  type="number"
                  required
                  min="0"
                  value={formData.amount}
                  onChange={(e) => setFormData(prev => ({ ...prev, amount: Number(e.target.value) }))}
                  className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Descripción</label>
              <input 
                type="text"
                required
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                placeholder="Ej: Pago de alquiler, Venta de repuesto..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Categoría</label>
              <input 
                type="text"
                required
                value={formData.category}
                onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                placeholder="Ej: Servicios, Varios..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Método de Pago</label>
              <select 
                value={formData.paymentMethod}
                onChange={(e) => setFormData(prev => ({ ...prev, paymentMethod: e.target.value as any }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              >
                <option value="Efectivo">Efectivo</option>
                <option value="Transferencia">Transferencia</option>
                <option value="Otro">Otro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Estado</label>
              <select 
                value={formData.status}
                onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as any }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              >
                <option value="Pagado">Pagado</option>
                <option value="Pendiente">Pendiente</option>
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => { setIsModalOpen(false); resetForm(); }}
              className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className={cn(
                "flex-1 px-4 py-2.5 text-white font-semibold rounded-xl shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed",
                modalType === 'Ingreso' ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20" : "bg-rose-600 hover:bg-rose-700 shadow-rose-500/20"
              )}
            >
              {saving ? 'Guardando...' : editingEntry ? 'Guardar Cambios' : `Guardar ${modalType}`}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
