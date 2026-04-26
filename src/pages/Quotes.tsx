import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { Product, Quote, QuoteItem, QuoteStatus, Customer, CustomerTransaction, Sale, CashFlowEntry } from '../types';
import { formatCurrency, cn, todayString } from '../lib/utils';
import {
  Plus, Search, Filter, Edit2, Trash2, Share2, ChevronDown,
  FileText, Copy, MessageCircle, Mail, Check, X, UserPlus, ArrowRight,
  CheckCircle2, Clock
} from 'lucide-react';
import Modal from '../components/Modal';
import { motion, AnimatePresence } from 'motion/react';

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Borrador',
  sent: 'Enviado',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  expired: 'Vencido',
};

const STATUS_COLORS: Record<QuoteStatus, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  expired: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

function getEffectiveStatus(quote: Quote): QuoteStatus {
  if (quote.status === 'accepted' || quote.status === 'rejected') return quote.status;
  if (new Date(quote.expiresAt) < new Date()) return 'expired';
  return quote.status;
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export default function Quotes() {
  const { user } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // List filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | QuoteStatus>('all');

  // Main modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);

  // Form state
  const [formStatus, setFormStatus] = useState<QuoteStatus>('draft');
  const [formClientId, setFormClientId] = useState('');
  const [formClientName, setFormClientName] = useState('');
  const [formClientPhone, setFormClientPhone] = useState('');
  const [formClientEmail, setFormClientEmail] = useState('');
  const [formDiscount, setFormDiscount] = useState(0);
  const [formValidDays, setFormValidDays] = useState<7 | 15 | 30>(15);
  const [formNotes, setFormNotes] = useState('');
  const [items, setItems] = useState<QuoteItem[]>([]);

  // Client search inside modal
  const [clientSearch, setClientSearch] = useState('');
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [savingClient, setSavingClient] = useState(false);

  // Product adding inside modal
  const [productSearch, setProductSearch] = useState('');
  const [addProductId, setAddProductId] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [addPrice, setAddPrice] = useState(0);

  // Share modal
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [sharingQuote, setSharingQuote] = useState<Quote | null>(null);
  const [copied, setCopied] = useState(false);

  // Convert modal
  const [isConvertOpen, setIsConvertOpen] = useState(false);
  const [convertingQuote, setConvertingQuote] = useState<Quote | null>(null);
  const [convertMode, setConvertMode] = useState<'paid' | 'credit'>('paid');
  const [convertMethod, setConvertMethod] = useState<'Efectivo' | 'Transferencia' | 'Otro'>('Efectivo');
  const [savingConvert, setSavingConvert] = useState(false);

  const fetchData = async () => {
    if (!user) return;
    const [q, p, c] = await Promise.all([
      db.list<Quote>('quotes', user.uid),
      db.list<Product>('products', user.uid),
      db.list<Customer>('customers', user.uid),
    ]);
    setQuotes(q.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setProducts(p);
    setCustomers(c);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase();
    if (!q) return products;
    return products.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }, [products, productSearch]);

  const filteredCustomers = useMemo(() => {
    const q = clientSearch.toLowerCase();
    if (!q) return [];
    return customers.filter(c => c.nameLower.includes(q)).slice(0, 6);
  }, [customers, clientSearch]);

  const subtotal = useMemo(() => items.reduce((acc, i) => acc + i.subtotal, 0), [items]);
  const total = useMemo(() => {
    const disc = Math.max(0, Math.min(100, formDiscount));
    return subtotal * (1 - disc / 100);
  }, [subtotal, formDiscount]);

  const filteredQuotes = useMemo(() => {
    return quotes.filter(q => {
      const matchSearch = q.clientName.toLowerCase().includes(search.toLowerCase()) ||
        q.number.toLowerCase().includes(search.toLowerCase());
      const effective = getEffectiveStatus(q);
      const matchStatus = statusFilter === 'all' || effective === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [quotes, search, statusFilter]);

  const generateNumber = async (): Promise<string> => {
    const existing = await db.list<Quote>('quotes', user!.uid);
    if (existing.length === 0) return 'PRES-0001';
    const nums = existing.map(q => {
      const m = q.number?.match(/(\d+)$/);
      return m ? parseInt(m[1]) : 0;
    });
    const next = Math.max(...nums) + 1;
    return `PRES-${String(next).padStart(4, '0')}`;
  };

  const resetForm = () => {
    setFormStatus('draft');
    setFormClientId('');
    setFormClientName('');
    setFormClientPhone('');
    setFormClientEmail('');
    setFormDiscount(0);
    setFormValidDays(15);
    setFormNotes('');
    setItems([]);
    setClientSearch('');
    setShowNewClientForm(false);
    setNewClientName('');
    setNewClientPhone('');
    setNewClientEmail('');
    setProductSearch('');
    setAddProductId('');
    setAddQty(1);
    setAddPrice(0);
  };

  const openNew = () => {
    setEditingQuote(null);
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (q: Quote) => {
    setEditingQuote(q);
    setFormStatus(q.status);
    setFormClientId(q.clientId);
    setFormClientName(q.clientName);
    setFormClientPhone(q.clientPhone || '');
    setFormClientEmail(q.clientEmail || '');
    setFormDiscount(q.discount);
    setFormValidDays(q.validDays);
    setFormNotes(q.notes);
    setItems(q.items);
    setClientSearch('');
    setShowNewClientForm(false);
    setProductSearch('');
    setAddProductId('');
    setAddQty(1);
    setAddPrice(0);
    setIsModalOpen(true);
  };

  const handleSelectProduct = (productId: string) => {
    const p = products.find(x => x.id === productId);
    if (p) {
      setAddProductId(productId);
      setAddPrice(p.salePrice);
    }
  };

  const handleAddItem = () => {
    if (!addProductId || addQty <= 0 || addPrice <= 0) return;
    const p = products.find(x => x.id === addProductId);
    if (!p) return;
    const existing = items.findIndex(i => i.productId === addProductId);
    if (existing >= 0) {
      const updated = [...items];
      const newQty = updated[existing].quantity + addQty;
      updated[existing] = {
        ...updated[existing],
        quantity: newQty,
        unitPrice: addPrice,
        subtotal: newQty * addPrice,
      };
      setItems(updated);
    } else {
      setItems(prev => [...prev, {
        productId: addProductId,
        productName: p.name,
        quantity: addQty,
        unitPrice: addPrice,
        subtotal: addQty * addPrice,
      }]);
    }
    setAddProductId('');
    setAddQty(1);
    setAddPrice(0);
    setProductSearch('');
  };

  const handleUpdateItemQty = (idx: number, qty: number) => {
    if (qty <= 0) return;
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: qty, subtotal: qty * it.unitPrice } : it));
  };

  const handleUpdateItemPrice = (idx: number, price: number) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, unitPrice: price, subtotal: it.quantity * price } : it));
  };

  const handleRemoveItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSelectClient = (c: Customer) => {
    setFormClientId(c.id);
    setFormClientName(c.name);
    setFormClientPhone(c.phone || '');
    setFormClientEmail(c.email || '');
    setClientSearch('');
    setShowNewClientForm(false);
  };

  const handleCreateClient = async () => {
    if (!user || !newClientName.trim() || savingClient) return;
    setSavingClient(true);
    try {
      const newCustomer = await db.create<Customer>('customers', {
        id: crypto.randomUUID(),
        ownerUid: user.uid,
        name: newClientName.trim(),
        nameLower: newClientName.trim().toLowerCase(),
        phone: newClientPhone.trim(),
        email: newClientEmail.trim(),
        currentBalance: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setCustomers(prev => [...prev, newCustomer]);
      handleSelectClient(newCustomer);
      setShowNewClientForm(false);
      setNewClientName('');
      setNewClientPhone('');
      setNewClientEmail('');
    } finally {
      setSavingClient(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || saving) return;
    if (items.length === 0) { alert('Agregá al menos un producto.'); return; }
    if (!formClientName.trim()) { alert('Ingresá un cliente.'); return; }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const expiresAt = addDays(formValidDays);

      if (editingQuote) {
        await db.update<Quote>('quotes', editingQuote.id, {
          clientId: formClientId,
          clientName: formClientName,
          clientPhone: formClientPhone || undefined,
          clientEmail: formClientEmail || undefined,
          items,
          subtotal,
          discount: formDiscount,
          total,
          status: formStatus,
          validDays: formValidDays,
          expiresAt,
          notes: formNotes,
          updatedAt: now,
        });
      } else {
        const number = await generateNumber();
        await db.create<Quote>('quotes', {
          id: crypto.randomUUID(),
          ownerUid: user.uid,
          number,
          clientId: formClientId,
          clientName: formClientName,
          clientPhone: formClientPhone || undefined,
          clientEmail: formClientEmail || undefined,
          items,
          subtotal,
          discount: formDiscount,
          total,
          status: formStatus,
          validDays: formValidDays,
          expiresAt,
          notes: formNotes,
          createdAt: now,
          updatedAt: now,
        });
      }
      setIsModalOpen(false);
      resetForm();
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este presupuesto?')) return;
    await db.delete('quotes', id);
    fetchData();
  };

  const openShare = (q: Quote) => {
    setSharingQuote(q);
    setCopied(false);
    setIsShareOpen(true);
  };

  const shareUrl = (q: Quote) => `${window.location.origin}/presupuesto/${q.id}`;

  const handleCopyLink = async () => {
    if (!sharingQuote) return;
    await navigator.clipboard.writeText(shareUrl(sharingQuote));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openConvert = (q: Quote) => {
    setConvertingQuote(q);
    setConvertMode(q.clientId ? 'paid' : 'paid');
    setConvertMethod('Efectivo');
    setIsConvertOpen(true);
  };

  const handleConvert = async () => {
    if (!user || !convertingQuote || savingConvert) return;
    setSavingConvert(true);
    try {
      const q = convertingQuote;
      const now = new Date().toISOString();
      const today = todayString();

      // Deduct stock for each item
      for (const item of q.items) {
        const prod = products.find(p => p.id === item.productId);
        if (prod) {
          await db.update<Product>('products', prod.id, { stock: Math.max(0, prod.stock - item.quantity) });
        }
      }

      const saleItems = q.items.map(i => ({ productId: i.productId, productName: i.productName, quantity: i.quantity, price: i.unitPrice }));
      const firstName = q.items[0];
      const isPaid = convertMode === 'paid';

      const newSale = await db.create<Sale>('sales', {
        id: crypto.randomUUID(),
        ownerUid: user.uid,
        date: today,
        productId: firstName?.productId || '',
        productName: q.items.length === 1 ? firstName?.productName || '' : `Presupuesto ${q.number}`,
        unitPrice: q.total,
        quantity: 1,
        adjustment: 0,
        total: q.total,
        status: isPaid ? 'Pagado' : 'Pendiente',
        paymentMethod: isPaid ? convertMethod : undefined,
        client: q.clientName,
        items: saleItems,
        createdAt: now,
      } as Sale);

      if (isPaid) {
        await db.create<CashFlowEntry>('cash_flow', {
          id: crypto.randomUUID(),
          ownerUid: user.uid,
          date: today,
          type: 'Ingreso',
          source: 'Venta',
          description: `Venta (${q.number}): ${q.clientName}`,
          category: 'Venta Externa',
          amount: q.total,
          paymentMethod: convertMethod,
          status: 'Pagado',
          saleId: newSale.id,
          createdAt: now,
        });
      } else if (q.clientId) {
        // Credit: update customer balance
        const customer = customers.find(c => c.id === q.clientId);
        if (customer) {
          await db.create<CustomerTransaction>('customer_transactions', {
            id: crypto.randomUUID(),
            ownerUid: user.uid,
            customerId: q.clientId,
            type: 'sale',
            amount: q.total,
            description: `Venta (${q.number}): ${q.clientName}`,
            relatedSaleId: newSale.id,
            relatedQuoteId: q.id,
            date: today,
            createdAt: now,
          });
          await db.update<Customer>('customers', q.clientId, {
            currentBalance: customer.currentBalance + q.total,
            updatedAt: now,
          });
        }
      }

      await db.update<Quote>('quotes', q.id, {
        convertedToSaleId: newSale.id,
        status: 'accepted',
        updatedAt: now,
      });

      setIsConvertOpen(false);
      setConvertingQuote(null);
      fetchData();
      alert(`Presupuesto convertido a venta exitosamente.`);
    } finally {
      setSavingConvert(false);
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
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Presupuestos</h2>
          <p className="text-slate-500 dark:text-slate-400">Crea y compartí presupuestos con tus clientes</p>
        </div>
        <button
          onClick={openNew}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all"
        >
          <Plus size={20} />
          Nuevo Presupuesto
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Buscar por cliente o número..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white appearance-none"
          >
            <option value="all">Todos los estados</option>
            <option value="draft">Borrador</option>
            <option value="sent">Enviado</option>
            <option value="accepted">Aceptado</option>
            <option value="rejected">Rechazado</option>
            <option value="expired">Vencido</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
              <tr>
                <th className="px-6 py-4">Número</th>
                <th className="px-6 py-4">Cliente</th>
                <th className="px-6 py-4">Total</th>
                <th className="px-6 py-4">Estado</th>
                <th className="px-6 py-4">Vencimiento</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredQuotes.map(q => {
                const effective = getEffectiveStatus(q);
                const expiresDate = new Date(q.expiresAt);
                const daysLeft = Math.ceil((expiresDate.getTime() - Date.now()) / 86400000);
                return (
                  <tr key={q.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-slate-400" />
                        <span className="font-bold text-slate-900 dark:text-white">{q.number}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-900 dark:text-white">{q.clientName}</p>
                      {q.clientPhone && <p className="text-xs text-slate-400">{q.clientPhone}</p>}
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-900 dark:text-white">
                      {formatCurrency(q.total)}
                      {q.discount > 0 && <span className="ml-1 text-xs text-emerald-600 font-medium">-{q.discount}%</span>}
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn('px-2 py-1 rounded-full text-[10px] font-bold uppercase', STATUS_COLORS[effective])}>
                        {STATUS_LABELS[effective]}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400 text-xs">
                      <div>{expiresDate.toLocaleDateString('es-AR')}</div>
                      {effective !== 'accepted' && effective !== 'rejected' && daysLeft > 0 && daysLeft <= 3 && (
                        <span className="text-orange-600 font-bold">¡{daysLeft}d!</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openShare(q)}
                          title="Compartir"
                          className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        >
                          <Share2 size={16} />
                        </button>
                        <button
                          onClick={() => openEdit(q)}
                          title="Editar"
                          className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        >
                          <Edit2 size={16} />
                        </button>
                        {(effective === 'accepted' && !q.convertedToSaleId) && (
                          <button
                            onClick={() => openConvert(q)}
                            title="Convertir a venta"
                            className="p-2 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                          >
                            <ArrowRight size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(q.id)}
                          title="Eliminar"
                          className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredQuotes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    No se encontraron presupuestos
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
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={editingQuote ? `Editar ${editingQuote.number}` : 'Nuevo Presupuesto'}
        className="max-w-3xl"
      >
        <form onSubmit={handleSave} className="space-y-6">
          {/* Client */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Cliente</label>
            {formClientName ? (
              <div className="flex items-center justify-between p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl">
                <div>
                  <p className="font-bold text-indigo-800 dark:text-indigo-300">{formClientName}</p>
                  {formClientPhone && <p className="text-xs text-indigo-600 dark:text-indigo-400">{formClientPhone}</p>}
                </div>
                <button type="button" onClick={() => { setFormClientId(''); setFormClientName(''); setFormClientPhone(''); setFormClientEmail(''); }} className="text-indigo-400 hover:text-indigo-700">
                  <X size={18} />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar cliente..."
                    value={clientSearch}
                    onChange={e => { setClientSearch(e.target.value); setShowNewClientForm(false); }}
                    className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white text-sm"
                  />
                </div>
                {filteredCustomers.length > 0 && (
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    {filteredCustomers.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectClient(c)}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800 last:border-0 transition-colors"
                      >
                        <p className="font-medium text-slate-900 dark:text-white text-sm">{c.name}</p>
                        {c.phone && <p className="text-xs text-slate-400">{c.phone}</p>}
                      </button>
                    ))}
                  </div>
                )}
                {clientSearch.length > 0 && filteredCustomers.length === 0 && !showNewClientForm && (
                  <button
                    type="button"
                    onClick={() => { setShowNewClientForm(true); setNewClientName(clientSearch); }}
                    className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:underline"
                  >
                    <UserPlus size={16} />
                    Crear cliente "{clientSearch}"
                  </button>
                )}
                <AnimatePresence>
                  {showNewClientForm && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3"
                    >
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Nuevo cliente</p>
                      <input
                        type="text"
                        placeholder="Nombre *"
                        value={newClientName}
                        onChange={e => setNewClientName(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                      />
                      <input
                        type="tel"
                        placeholder="Teléfono"
                        value={newClientPhone}
                        onChange={e => setNewClientPhone(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                      />
                      <input
                        type="email"
                        placeholder="Email"
                        value={newClientEmail}
                        onChange={e => setNewClientEmail(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                      />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setShowNewClientForm(false)} className="flex-1 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500">Cancelar</button>
                        <button type="button" disabled={savingClient} onClick={handleCreateClient} className="flex-1 py-2 text-sm bg-indigo-600 text-white rounded-lg font-semibold disabled:opacity-60">
                          {savingClient ? 'Guardando...' : 'Crear'}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {/* Manual name entry if no customer account needed */}
                {!showNewClientForm && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="O escribí el nombre directamente..."
                      value={formClientName}
                      onChange={e => setFormClientName(e.target.value)}
                      className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Products */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Productos</label>
            <div className="grid grid-cols-12 gap-2 mb-2">
              <div className="col-span-5 relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar producto..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="w-full pl-7 pr-2 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                />
              </div>
              <div className="col-span-3">
                <select
                  value={addProductId}
                  onChange={e => handleSelectProduct(e.target.value)}
                  className="w-full px-2 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none dark:text-white"
                >
                  <option value="">Seleccionar</option>
                  {filteredProducts.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.stock})</option>
                  ))}
                </select>
              </div>
              <input
                type="number"
                min="1"
                value={addQty}
                onChange={e => setAddQty(Number(e.target.value))}
                className="col-span-2 px-2 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none dark:text-white"
                placeholder="Cant."
              />
              <button
                type="button"
                onClick={handleAddItem}
                className="col-span-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1 hover:bg-indigo-700 transition-colors"
              >
                <Plus size={16} />
                Agregar
              </button>
            </div>

            {items.length > 0 && (
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Producto</th>
                      <th className="px-4 py-2 text-center">Cant.</th>
                      <th className="px-4 py-2 text-center">Precio U.</th>
                      <th className="px-4 py-2 text-right">Subtotal</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2 font-medium text-slate-900 dark:text-white">{item.productName}</td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={e => handleUpdateItemQty(idx, Number(e.target.value))}
                            className="w-16 text-center px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none dark:text-white"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="0"
                            value={item.unitPrice}
                            onChange={e => handleUpdateItemPrice(idx, Number(e.target.value))}
                            className="w-24 text-center px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none dark:text-white"
                          />
                        </td>
                        <td className="px-4 py-2 text-right font-bold text-slate-900 dark:text-white">{formatCurrency(item.subtotal)}</td>
                        <td className="px-2 py-2">
                          <button type="button" onClick={() => handleRemoveItem(idx)} className="text-slate-300 hover:text-rose-500 transition-colors">
                            <X size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Settings row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Descuento (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={formDiscount}
                onChange={e => setFormDiscount(Number(e.target.value))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Validez</label>
              <div className="flex gap-1">
                {([7, 15, 30] as const).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setFormValidDays(d)}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-sm font-semibold border transition-all',
                      formValidDays === d ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    )}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Estado</label>
              <select
                value={formStatus}
                onChange={e => setFormStatus(e.target.value as QuoteStatus)}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none dark:text-white"
              >
                <option value="draft">Borrador</option>
                <option value="sent">Enviado</option>
                <option value="accepted">Aceptado</option>
                <option value="rejected">Rechazado</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Notas</label>
            <textarea
              value={formNotes}
              onChange={e => setFormNotes(e.target.value)}
              rows={2}
              placeholder="Condiciones, observaciones..."
              className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white text-sm resize-none"
            />
          </div>

          {/* Total */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400 mb-1">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {formDiscount > 0 && (
              <div className="flex justify-between text-sm text-emerald-600 mb-1">
                <span>Descuento ({formDiscount}%)</span>
                <span>-{formatCurrency(subtotal - total)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-black text-slate-900 dark:text-white pt-2 border-t border-slate-200 dark:border-slate-700">
              <span>Total</span>
              <span className="text-indigo-600 dark:text-indigo-400">{formatCurrency(total)}</span>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
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
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-60"
            >
              {saving ? 'Guardando...' : editingQuote ? 'Guardar Cambios' : 'Crear Presupuesto'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Share Modal */}
      <Modal isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} title="Compartir Presupuesto" className="max-w-md">
        {sharingQuote && (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">Link del presupuesto:</p>
              <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <span className="flex-1 text-xs text-slate-700 dark:text-slate-300 truncate">{shareUrl(sharingQuote)}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={handleCopyLink}
                className="flex items-center justify-center gap-2 w-full py-3 bg-slate-900 dark:bg-slate-700 text-white rounded-xl font-semibold hover:bg-slate-800 transition-colors"
              >
                {copied ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} />}
                {copied ? 'Link copiado' : 'Copiar link'}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Hola, te comparto el presupuesto: ${shareUrl(sharingQuote)}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-colors"
              >
                <MessageCircle size={18} />
                Compartir por WhatsApp
              </a>
              {sharingQuote.clientEmail && (
                <a
                  href={`mailto:${sharingQuote.clientEmail}?subject=Presupuesto ${sharingQuote.number}&body=Hola ${sharingQuote.clientName}, te comparto el presupuesto: ${shareUrl(sharingQuote)}`}
                  className="flex items-center justify-center gap-2 w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
                >
                  <Mail size={18} />
                  Enviar por Email
                </a>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Convert Modal */}
      <Modal isOpen={isConvertOpen} onClose={() => setIsConvertOpen(false)} title="Convertir a Venta" className="max-w-md">
        {convertingQuote && (
          <div className="space-y-5">
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
              <p className="text-sm text-slate-500 dark:text-slate-400">Presupuesto</p>
              <p className="font-bold text-slate-900 dark:text-white">{convertingQuote.number} — {convertingQuote.clientName}</p>
              <p className="text-xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{formatCurrency(convertingQuote.total)}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Forma de pago</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConvertMode('paid')}
                  className={cn(
                    'flex-1 py-3 rounded-xl font-bold border-2 flex items-center justify-center gap-2 transition-all',
                    convertMode === 'paid' ? 'bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-500 dark:text-emerald-400' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400'
                  )}
                >
                  <CheckCircle2 size={18} />
                  Pago ahora
                </button>
                {convertingQuote.clientId && (
                  <button
                    type="button"
                    onClick={() => setConvertMode('credit')}
                    className={cn(
                      'flex-1 py-3 rounded-xl font-bold border-2 flex items-center justify-center gap-2 transition-all',
                      convertMode === 'credit' ? 'bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-900/20 dark:border-amber-500 dark:text-amber-400' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400'
                    )}
                  >
                    <Clock size={18} />
                    Cuenta corriente
                  </button>
                )}
              </div>
            </div>

            {convertMode === 'paid' && (
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Método de pago</p>
                <div className="flex gap-2">
                  {(['Efectivo', 'Transferencia', 'Otro'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setConvertMethod(m)}
                      className={cn(
                        'flex-1 py-2 rounded-lg text-sm font-semibold border transition-all',
                        convertMethod === m ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setIsConvertOpen(false)}
                className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingConvert}
                onClick={handleConvert}
                className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-60"
              >
                {savingConvert ? 'Procesando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
