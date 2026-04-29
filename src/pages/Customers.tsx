import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { db, callRpc } from '../lib/db';
import { Customer, CustomerTransaction } from '../types';
import { formatCurrency, cn, todayString, formatDate } from '../lib/utils';
import {
  Plus, Search, Edit2, Trash2, Eye, Users,
  TrendingUp, TrendingDown, Minus, CheckCircle2
} from 'lucide-react';
import Modal from '../components/Modal';
import { motion, AnimatePresence } from 'motion/react';

export default function Customers() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // Create/edit modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Ficha modal
  const [isFichaOpen, setIsFichaOpen] = useState(false);
  const [fichaCustomer, setFichaCustomer] = useState<Customer | null>(null);
  const [transactions, setTransactions] = useState<CustomerTransaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);

  // Payment form
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Efectivo' | 'Transferencia' | 'Otro'>('Efectivo');
  const [savingPayment, setSavingPayment] = useState(false);

  // Adjustment form
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [adjIsPositive, setAdjIsPositive] = useState(true);
  const [savingAdj, setSavingAdj] = useState(false);

  // Active tab in ficha
  const [fichaTab, setFichaTab] = useState<'payment' | 'adjustment' | 'history'>('history');

  // Toast message
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchData = async () => {
    if (!user) return;
    const c = await db.list<Customer>('customers', user.uid);
    setCustomers(c.sort((a, b) => a.name.localeCompare(b.name)));
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const filteredCustomers = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return customers;
    return customers.filter(c => c.nameLower.includes(q) || c.phone?.includes(q));
  }, [customers, search]);

  const loadTransactions = async (customerId: string) => {
    setLoadingTx(true);
    try {
      const txs = await db.findBy<CustomerTransaction>('customer_transactions', [
        { field: 'customerId', value: customerId },
        { field: 'ownerUid', value: user!.uid },
      ]);
      setTransactions(txs.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)));
    } finally {
      setLoadingTx(false);
    }
  };

  const openFicha = (c: Customer) => {
    setFichaCustomer(c);
    setFichaTab('history');
    setPaymentAmount('');
    setPaymentNote('');
    setPaymentMethod('Efectivo');
    setAdjAmount('');
    setAdjNote('');
    setAdjIsPositive(true);
    loadTransactions(c.id);
    setIsFichaOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditingCustomer(c);
    setFormName(c.name);
    setFormPhone(c.phone || '');
    setFormEmail(c.email || '');
    setFormNotes(c.notes || '');
    setIsModalOpen(true);
  };

  const openNew = () => {
    setEditingCustomer(null);
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormNotes('');
    setIsModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || saving || !formName.trim()) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (editingCustomer) {
        await db.update<Customer>('customers', editingCustomer.id, {
          name: formName.trim(),
          nameLower: formName.trim().toLowerCase(),
          phone: formPhone.trim() || undefined,
          email: formEmail.trim() || undefined,
          notes: formNotes.trim() || undefined,
          updatedAt: now,
        });
        if (fichaCustomer?.id === editingCustomer.id) {
          const updated = await db.get<Customer>('customers', editingCustomer.id);
          if (updated) setFichaCustomer(updated);
        }
      } else {
        await db.create<Customer>('customers', {
          id: crypto.randomUUID(),
          ownerUid: user.uid,
          name: formName.trim(),
          nameLower: formName.trim().toLowerCase(),
          phone: formPhone.trim() || undefined,
          email: formEmail.trim() || undefined,
          notes: formNotes.trim() || undefined,
          currentBalance: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
      setIsModalOpen(false);
      fetchData();
      showMessage(editingCustomer ? 'Cliente actualizado' : 'Cliente creado');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Customer) => {
    if (c.currentBalance !== 0) {
      alert('No podés eliminar un cliente con saldo pendiente.');
      return;
    }
    if (!confirm(`¿Eliminar a ${c.name}?`)) return;
    await db.delete('customers', c.id);
    fetchData();
  };

  const handleRegisterPayment = async () => {
    if (!user || !fichaCustomer || savingPayment) return;
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0 || !paymentNote.trim()) {
      alert('Ingresá monto y nota.');
      return;
    }
    setSavingPayment(true);
    try {
      await callRpc('register_customer_payment', {
        p_customer_id:    fichaCustomer.id,
        p_amount:         amount,
        p_payment_method: paymentMethod,
        p_description:    paymentNote.trim(),
      });
      const [updated] = await Promise.all([
        db.get<Customer>('customers', fichaCustomer.id),
        loadTransactions(fichaCustomer.id),
      ]);
      if (updated) {
        setFichaCustomer(updated);
        setCustomers(prev => prev.map(c => c.id === fichaCustomer.id ? updated : c));
      }
      setPaymentAmount('');
      setPaymentNote('');
      setPaymentMethod('Efectivo');
      setFichaTab('history');
      showMessage('Pago registrado');
    } catch (error) {
      console.error('Error al registrar pago:', error);
      showMessage(error instanceof Error ? error.message : 'Error al registrar el pago.', 'error');
    } finally {
      setSavingPayment(false);
    }
  };

  const handleRegisterAdjustment = async () => {
    if (!user || !fichaCustomer || savingAdj) return;
    const amount = parseFloat(adjAmount);
    if (!amount || amount <= 0 || !adjNote.trim()) {
      alert('Ingresá monto y nota.');
      return;
    }
    setSavingAdj(true);
    try {
      const now = new Date().toISOString();
      const signedAmount = adjIsPositive ? amount : -amount;
      await db.create<CustomerTransaction>('customer_transactions', {
        id: crypto.randomUUID(),
        ownerUid: user.uid,
        customerId: fichaCustomer.id,
        type: 'adjustment',
        amount: signedAmount,
        description: adjNote.trim(),
        date: todayString(),
        createdAt: now,
      });
      const newBalance = fichaCustomer.currentBalance + signedAmount;
      await db.update<Customer>('customers', fichaCustomer.id, {
        currentBalance: newBalance,
        updatedAt: now,
      });
      setFichaCustomer(prev => prev ? { ...prev, currentBalance: newBalance } : null);
      setCustomers(prev => prev.map(c => c.id === fichaCustomer.id ? { ...c, currentBalance: newBalance } : c));
      setAdjAmount('');
      setAdjNote('');
      setFichaTab('history');
      loadTransactions(fichaCustomer.id);
      showMessage('Ajuste registrado');
    } finally {
      setSavingAdj(false);
    }
  };

  // Running balance for history table
  const txWithBalance = useMemo(() => {
    let running = 0;
    return transactions.map(tx => {
      running += tx.amount;
      return { ...tx, runningBalance: running };
    });
  }, [transactions]);

  const balanceColor = (balance: number) => {
    if (balance > 0) return 'text-rose-600 dark:text-rose-400';
    if (balance < 0) return 'text-blue-600 dark:text-blue-400';
    return 'text-emerald-600 dark:text-emerald-400';
  };

  const txTypeLabel = (type: string) => {
    if (type === 'sale') return 'Venta';
    if (type === 'payment') return 'Pago';
    return 'Ajuste';
  };

  const txTypeBadge = (type: string) => {
    if (type === 'sale') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
    if (type === 'payment') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';
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
      {/* Toast */}
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
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
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Clientes</h2>
          <p className="text-slate-500 dark:text-slate-400">Cuentas corrientes y historial de pagos</p>
        </div>
        <button
          onClick={openNew}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all"
        >
          <Plus size={20} />
          Nuevo Cliente
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input
          type="text"
          placeholder="Buscar por nombre o teléfono..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
        />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
              <tr>
                <th className="px-6 py-4">Nombre</th>
                <th className="px-6 py-4">Teléfono</th>
                <th className="px-6 py-4">Saldo</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredCustomers.map(c => (
                <tr key={c.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-bold text-slate-900 dark:text-white">{c.name}</p>
                    {c.email && <p className="text-xs text-slate-400">{c.email}</p>}
                  </td>
                  <td className="px-6 py-4 text-slate-600 dark:text-slate-400">{c.phone || '-'}</td>
                  <td className="px-6 py-4">
                    <span className={cn('font-bold', balanceColor(c.currentBalance))}>
                      {c.currentBalance === 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400">Al día</span>
                      ) : (
                        formatCurrency(Math.abs(c.currentBalance))
                      )}
                    </span>
                    {c.currentBalance > 0 && <span className="text-xs text-slate-400 ml-1">debe</span>}
                    {c.currentBalance < 0 && <span className="text-xs text-slate-400 ml-1">a favor</span>}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openFicha(c)}
                        title="Ver ficha"
                        className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        onClick={() => openEdit(c)}
                        title="Editar"
                        className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        title="Eliminar"
                        className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    <Users size={32} className="mx-auto mb-2 opacity-30" />
                    No se encontraron clientes
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}
        className="max-w-md"
      >
        <form onSubmit={handleSaveCustomer} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Nombre *</label>
            <input
              type="text"
              required
              value={formName}
              onChange={e => setFormName(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Teléfono</label>
            <input
              type="tel"
              value={formPhone}
              onChange={e => setFormPhone(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
            <input
              type="email"
              value={formEmail}
              onChange={e => setFormEmail(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Notas</label>
            <textarea
              value={formNotes}
              onChange={e => setFormNotes(e.target.value)}
              rows={2}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white resize-none text-sm"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-60"
            >
              {saving ? 'Guardando...' : editingCustomer ? 'Guardar Cambios' : 'Crear Cliente'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Ficha Modal */}
      <Modal
        isOpen={isFichaOpen}
        onClose={() => setIsFichaOpen(false)}
        title="Ficha del Cliente"
        className="max-w-2xl"
      >
        {fichaCustomer && (
          <div className="space-y-5">
            {/* Customer info */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
              <div>
                <p className="font-black text-lg text-slate-900 dark:text-white">{fichaCustomer.name}</p>
                {fichaCustomer.phone && <p className="text-sm text-slate-500">{fichaCustomer.phone}</p>}
                {fichaCustomer.email && <p className="text-sm text-slate-500">{fichaCustomer.email}</p>}
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400 uppercase font-semibold tracking-wide">Saldo</p>
                <p className={cn('text-2xl font-black', balanceColor(fichaCustomer.currentBalance))}>
                  {formatCurrency(Math.abs(fichaCustomer.currentBalance))}
                </p>
                <p className="text-xs text-slate-400">
                  {fichaCustomer.currentBalance === 0 ? 'Al día' : fichaCustomer.currentBalance > 0 ? 'nos debe' : 'a su favor'}
                </p>
              </div>
            </div>

            {/* Action tabs */}
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
              {([
                { key: 'history', label: 'Historial' },
                { key: 'payment', label: 'Registrar Pago' },
                { key: 'adjustment', label: 'Ajuste Manual' },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setFichaTab(tab.key)}
                  className={cn(
                    'flex-1 py-2 rounded-lg text-sm font-semibold transition-all',
                    fichaTab === tab.key ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Payment form */}
            {fichaTab === 'payment' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">Registrá un pago del cliente para reducir su saldo.</p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Monto *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={paymentAmount}
                    onChange={e => setPaymentAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Método de pago *</label>
                  <select
                    value={paymentMethod}
                    onChange={e => setPaymentMethod(e.target.value as 'Efectivo' | 'Transferencia' | 'Otro')}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                  >
                    <option value="Efectivo">Efectivo</option>
                    <option value="Transferencia">Transferencia</option>
                    <option value="Otro">Otro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nota *</label>
                  <input
                    type="text"
                    value={paymentNote}
                    onChange={e => setPaymentNote(e.target.value)}
                    placeholder="Ej: Pago en efectivo, transferencia..."
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                  />
                </div>
                <button
                  type="button"
                  disabled={savingPayment}
                  onClick={handleRegisterPayment}
                  className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <CheckCircle2 size={18} />
                  {savingPayment ? 'Guardando...' : 'Registrar Pago'}
                </button>
              </div>
            )}

            {/* Adjustment form */}
            {fichaTab === 'adjustment' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">Ajuste manual del saldo. La nota es obligatoria.</p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAdjIsPositive(true)}
                      className={cn(
                        'flex-1 py-2.5 rounded-xl font-bold border-2 flex items-center justify-center gap-2 transition-all',
                        adjIsPositive ? 'bg-rose-50 border-rose-500 text-rose-700 dark:bg-rose-900/20 dark:border-rose-500 dark:text-rose-400' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400'
                      )}
                    >
                      <TrendingUp size={16} />
                      Suma deuda
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjIsPositive(false)}
                      className={cn(
                        'flex-1 py-2.5 rounded-xl font-bold border-2 flex items-center justify-center gap-2 transition-all',
                        !adjIsPositive ? 'bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-500 dark:text-emerald-400' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400'
                      )}
                    >
                      <TrendingDown size={16} />
                      Resta deuda
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Monto *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={adjAmount}
                    onChange={e => setAdjAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nota *</label>
                  <input
                    type="text"
                    value={adjNote}
                    onChange={e => setAdjNote(e.target.value)}
                    placeholder="Motivo del ajuste..."
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                  />
                </div>
                <button
                  type="button"
                  disabled={savingAdj}
                  onClick={handleRegisterAdjustment}
                  className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-60"
                >
                  {savingAdj ? 'Guardando...' : 'Registrar Ajuste'}
                </button>
              </div>
            )}

            {/* History */}
            {fichaTab === 'history' && (
              <div>
                {loadingTx ? (
                  <div className="py-8 flex justify-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
                  </div>
                ) : txWithBalance.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-sm">
                    <Minus size={24} className="mx-auto mb-2 opacity-30" />
                    Sin movimientos registrados
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-slate-400 dark:text-slate-500 font-semibold border-b border-slate-100 dark:border-slate-800">
                        <tr>
                          <th className="pb-2 text-left">Fecha</th>
                          <th className="pb-2 text-left">Descripción</th>
                          <th className="pb-2 text-center">Tipo</th>
                          <th className="pb-2 text-right">Monto</th>
                          <th className="pb-2 text-right">Saldo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                        {txWithBalance.map(tx => (
                          <tr key={tx.id}>
                            <td className="py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(tx.date)}</td>
                            <td className="py-2.5 text-slate-700 dark:text-slate-300">{tx.description}</td>
                            <td className="py-2.5 text-center">
                              <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase', txTypeBadge(tx.type))}>
                                {txTypeLabel(tx.type)}
                              </span>
                            </td>
                            <td className={cn('py-2.5 text-right font-semibold', tx.amount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
                              {tx.amount > 0 ? '+' : ''}{formatCurrency(tx.amount)}
                            </td>
                            <td className={cn('py-2.5 text-right font-bold', balanceColor(tx.runningBalance))}>
                              {formatCurrency(tx.runningBalance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
