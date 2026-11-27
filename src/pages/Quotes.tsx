import { lazyWithRetry } from '../lib/lazyWithRetry';
import { usePagination } from '../hooks/usePagination';
import Pagination from '../components/Pagination';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { usePermission } from '../hooks/usePermission';
import { useInventoryOwners } from '../hooks/useInventoryOwners';
import { db, callRpc } from '../lib/db';
import { CatalogConfig, Product, Quote, QuoteItem, QuoteStatus, Customer } from '../types';
import { formatCurrency, cn } from '../lib/utils';
import {
  Plus, Search, Filter, Edit2, Trash2, Share2, ChevronDown,
  FileText, Copy, MessageCircle, Check, X, UserPlus, ArrowRight,
  CheckCircle2, Clock, Eye, Download, Printer, RefreshCw
} from 'lucide-react';
import Modal from '../components/Modal';
import ProductSearchSelect from '../components/ProductSearchSelect';
import ProductThumbnail from '../components/stock/ProductThumbnail';
import QuoteDocument from '../components/quotes/QuoteDocument';
import { buildQuotePdfBlob } from '../lib/quotePdf';
import NumberField from '../components/NumberField';
import MoneyInput from '../components/MoneyInput';
import '../styles/business-redesign.css';
import { filterOwnInventoryProducts } from '../lib/ownInventory';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileQuotes from '../components/quotes/MobileQuotes';
import { useSearchParams } from 'react-router-dom';
import { calculateTotalWithShipping } from '../lib/saleShipping';

const LazySaleShippingControl = lazyWithRetry('src/components/SaleShippingControl.tsx', () => import('../components/SaleShippingControl'));

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
  if (quote.effectiveStatus) return quote.effectiveStatus;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, refetchToken } = useAuth();
  const { owners: inventoryOwners } = useInventoryOwners(user?.uid, refetchToken);
  const canWrite = usePermission('presupuestos', 'write');
  const canDelete = usePermission('presupuestos', 'delete');
  const isMobile = useIsMobile();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [catalogConfig, setCatalogConfig] = useState<CatalogConfig | null>(null);
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
  const [shippingEnabled, setShippingEnabled] = useState(false);
  const [formShippingAmount, setFormShippingAmount] = useState(0);
  const [formValidDays, setFormValidDays] = useState<7 | 15 | 30>(15);
  const [formNotes, setFormNotes] = useState('');
  const [formInternalNotes, setFormInternalNotes] = useState('');
  const [renewalRequested, setRenewalRequested] = useState(false);
  const [items, setItems] = useState<QuoteItem[]>([]);

  // Client search inside modal
  const [clientSearch, setClientSearch] = useState('');
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [savingClient, setSavingClient] = useState(false);

  // Product adding inside modal
  const [addProductId, setAddProductId] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [addPrice, setAddPrice] = useState(0);
  const [addAvailability, setAddAvailability] = useState<NonNullable<QuoteItem['availability']>>('confirm');
  const [addLeadTime, setAddLeadTime] = useState('');
  const productSearchRef = useRef<HTMLDivElement>(null);

  // Share modal
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [sharingQuote, setSharingQuote] = useState<Quote | null>(null);
  const [copied, setCopied] = useState(false);
  const [whatsAppMessage, setWhatsAppMessage] = useState('');
  const [previewQuote, setPreviewQuote] = useState<Quote | null>(null);
  const [previewUsesForm, setPreviewUsesForm] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<'customer' | 'pdf'>('customer');
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const pdfFrameRef = useRef<HTMLIFrameElement>(null);

  // Convert modal
  const [isConvertOpen, setIsConvertOpen] = useState(false);
  const [convertingQuote, setConvertingQuote] = useState<Quote | null>(null);
  const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null);
  const [convertMode, setConvertMode] = useState<'paid' | 'credit'>('paid');
  const [convertMethod, setConvertMethod] = useState<'Efectivo' | 'Transferencia' | 'Otro'>('Efectivo');
  const [savingConvert, setSavingConvert] = useState(false);

  const fetchData = async () => {
    if (!user) return;
    try {
      const [q, p, c, catalog] = await Promise.all([
        db.list<Quote>('quotes', user.uid),
        db.list<Product>('products', user.uid),
        db.list<Customer>('customers', user.uid),
        db.list<CatalogConfig>('catalog_config', user.uid),
      ]);
      setQuotes(q.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setProducts(filterOwnInventoryProducts(p));
      setCustomers(c);
      setCatalogConfig(catalog[0] ?? null);
    } catch (err) {
      console.error('[Quotes] fetchData error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [q, p, c, catalog] = await Promise.all([
          db.list<Quote>('quotes', user.uid),
          db.list<Product>('products', user.uid),
          db.list<Customer>('customers', user.uid),
          db.list<CatalogConfig>('catalog_config', user.uid),
        ]);
        if (cancelled) return;
        setQuotes(q.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        setProducts(filterOwnInventoryProducts(p));
        setCustomers(c);
        setCatalogConfig(catalog[0] ?? null);
      } catch (err) {
        if (cancelled) return;
        console.error('[Quotes] fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, refetchToken]);

  useEffect(() => () => {
    if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
  }, [previewPdfUrl]);

  const filteredCustomers = useMemo(() => {
    const q = clientSearch.trim().toLocaleLowerCase('es-AR');
    if (!q) return [];
    return customers.filter(c => (c.nameLower || c.name.toLocaleLowerCase('es-AR')).includes(q)).slice(0, 6);
  }, [customers, clientSearch]);

  const subtotal = useMemo(() => items.reduce((acc, i) => acc + i.subtotal, 0), [items]);
  const total = useMemo(() => {
    const disc = Math.max(0, Math.min(100, formDiscount));
    const baseTotal = subtotal * (1 - disc / 100);
    return calculateTotalWithShipping(baseTotal, shippingEnabled, formShippingAmount);
  }, [subtotal, formDiscount, shippingEnabled, formShippingAmount]);
  const selectedProduct = useMemo(() => products.find(product => product.id === addProductId) ?? null, [products, addProductId]);
  const previewDraftQuote = useMemo<Quote>(() => ({
    id: editingQuote?.id ?? 'preview', ownerUid: user?.uid ?? '', number: editingQuote?.number ?? 'BORRADOR',
    clientId: formClientId || null, clientName: formClientName.trim() || 'Cliente',
    clientPhone: formClientPhone || undefined, clientEmail: formClientEmail || undefined,
    items, subtotal, discount: formDiscount, shippingAmount: shippingEnabled ? formShippingAmount : 0,
    total, status: formStatus, validDays: formValidDays,
    expiresAt: editingQuote?.expiresAt ?? addDays(formValidDays),
    notes: formNotes, internalNotes: formInternalNotes,
    createdAt: editingQuote?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
  }), [editingQuote, user?.uid, formClientId, formClientName, formClientPhone, formClientEmail, items, subtotal, formDiscount, shippingEnabled, formShippingAmount, total, formStatus, formValidDays, formNotes, formInternalNotes]);

  const filteredQuotes = useMemo(() => {
    return quotes.filter(q => {
      const matchSearch = q.clientName.toLowerCase().includes(search.toLowerCase()) ||
        q.number.toLowerCase().includes(search.toLowerCase());
      const effective = getEffectiveStatus(q);
      const matchStatus = statusFilter === 'all' || effective === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [quotes, search, statusFilter]);
  const pagination = usePagination(filteredQuotes);

  const generateNumber = async (): Promise<string> => {
    try {
      return await callRpc<string>('next_quote_number', { p_user: user!.uid });
    } catch {
      // Fallback to client-side if RPC not yet deployed
      const existing = await db.list<Quote>('quotes', user!.uid);
      if (existing.length === 0) return 'PRES-0001';
      const nums = existing.map(q => {
        const m = q.number?.match(/(\d+)$/);
        return m ? parseInt(m[1]) : 0;
      });
      return `PRES-${String(Math.max(...nums) + 1).padStart(4, '0')}`;
    }
  };

  const resetForm = () => {
    setFormStatus('draft');
    setFormClientId('');
    setFormClientName('');
    setFormClientPhone('');
    setFormClientEmail('');
    setFormDiscount(0);
    setShippingEnabled(false);
    setFormShippingAmount(0);
    setFormValidDays(15);
    setFormNotes('');
    setFormInternalNotes('');
    setRenewalRequested(false);
    setItems([]);
    setClientSearch('');
    setShowNewClientForm(false);
    setNewClientName('');
    setNewClientPhone('');
    setNewClientEmail('');
    setAddProductId('');
    setAddQty(1);
    setAddPrice(0);
    setAddAvailability('confirm');
    setAddLeadTime('');
  };

  const openNew = () => {
    setEditingQuote(null);
    resetForm();
    setIsModalOpen(true);
  };

  useEffect(() => {
    if (searchParams.get('action') !== 'new' || !canWrite) return;
    openNew();
    const next = new URLSearchParams(searchParams);
    next.delete('action');
    setSearchParams(next, { replace: true });
  }, [canWrite, searchParams, setSearchParams]);

  const openEdit = (q: Quote) => {
    setEditingQuote(q);
    setFormStatus(q.status);
    setFormClientId(q.clientId ?? '');
    setFormClientName(q.clientName);
    setFormClientPhone(q.clientPhone || '');
    setFormClientEmail(q.clientEmail || '');
    setFormDiscount(q.discount);
    setFormShippingAmount(Number(q.shippingAmount) || 0);
    setShippingEnabled(Number(q.shippingAmount) > 0);
    setFormValidDays(q.validDays);
    setFormNotes(q.notes || '');
    setFormInternalNotes(q.internalNotes || '');
    setRenewalRequested(false);
    setItems(q.items);
    setClientSearch('');
    setShowNewClientForm(false);
    setAddProductId('');
    setAddQty(1);
    setAddPrice(0);
    setAddAvailability('confirm');
    setAddLeadTime('');
    setIsModalOpen(true);
  };

  const handleSelectProduct = (productId: string) => {
    if (!productId) {
      setAddProductId('');
      setAddPrice(0);
      setAddAvailability('confirm');
      setAddLeadTime('');
      return;
    }
    const p = products.find(x => x.id === productId);
    if (p) {
      setAddProductId(productId);
      setAddPrice(p.salePrice);
      setAddAvailability(p.stock > 0 ? 'immediate' : 'confirm');
      setAddLeadTime('');
    }
  };

  const handleAddItem = () => {
    if (!addProductId || addQty <= 0 || addPrice <= 0) return;
    const product = products.find(item => item.id === addProductId);
    if (!product) return;
    const existing = items.findIndex(item => item.productId === addProductId);
    if (existing >= 0) {
      const updated = [...items];
      const newQty = updated[existing].quantity + addQty;
      updated[existing] = {
        ...updated[existing],
        quantity: newQty,
        unitPrice: addPrice,
        subtotal: newQty * addPrice,
        availability: addAvailability,
        leadTime: addLeadTime.trim() || updated[existing].leadTime,
      };
      setItems(updated);
    } else {
      setItems(current => [...current, {
        productId: addProductId,
        productName: product.name,
        quantity: addQty,
        unitPrice: addPrice,
        subtotal: addQty * addPrice,
        availability: addAvailability,
        leadTime: addLeadTime.trim() || undefined,
      }]);
    }
    setAddProductId('');
    setAddQty(1);
    setAddPrice(0);
    setAddAvailability('confirm');
    setAddLeadTime('');
    window.requestAnimationFrame(() => productSearchRef.current?.querySelector('input')?.focus());
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
      const expiresAt = editingQuote && !renewalRequested ? editingQuote.expiresAt : addDays(formValidDays);
      const quoteData = {
        clientId: formClientId || null,
        clientName: formClientName.trim(),
        clientPhone: formClientPhone || undefined,
        clientEmail: formClientEmail || undefined,
        items, subtotal, discount: formDiscount,
        shippingAmount: shippingEnabled ? formShippingAmount : 0,
        total, status: formStatus, validDays: formValidDays, expiresAt,
        notes: formNotes.trim(), internalNotes: formInternalNotes.trim(), updatedAt: now,
      };
      if (editingQuote) {
        await db.update<Quote>('quotes', editingQuote.id, quoteData);
      } else {
        const number = await generateNumber();
        await db.create<Quote>('quotes', {
          id: crypto.randomUUID(), ownerUid: user.uid, number, ...quoteData, createdAt: now,
        });
      }
      setIsModalOpen(false);
      resetForm();
      fetchData();
    } catch (error) {
      console.error('[Quotes] Error al guardar:', error);
      alert(error instanceof Error ? error.message : 'No se pudo guardar el presupuesto.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (quote: Quote) => {
    if (!confirm('¿Eliminar este presupuesto?')) return;
    if (quote.convertedToSaleId) {
      if (confirm('Este presupuesto ya fue convertido a venta. ¿Querés borrar también la venta vinculada?')) {
        await callRpc('delete_sale', { p_sale_id: quote.convertedToSaleId });
      }
    }
    await db.delete('quotes', quote.id);
    fetchData();
  };

  const handleMobileDelete = async (deleteLinkedSale: boolean) => {
    if (!quoteToDelete) return;
    if (deleteLinkedSale && quoteToDelete.convertedToSaleId) {
      await callRpc('delete_sale', { p_sale_id: quoteToDelete.convertedToSaleId });
    }
    await db.delete('quotes', quoteToDelete.id);
    setQuoteToDelete(null);
    fetchData();
  };

  const shareUrl = (q: Quote) => window.location.origin + '/presupuesto/' + q.id;
  const makeWhatsAppMessage = (q: Quote) => {
    const business = catalogConfig?.businessName || 'RivaTech';
    const productsText = q.items.map(item => item.productName + ' x' + item.quantity).join(', ');
    const discountText = q.discount > 0 ? 'Incluye un ' + q.discount + ' % de descuento.' : '';
    const shippingText = Number(q.shippingAmount) > 0 ? 'Envío: ' + formatCurrency(Number(q.shippingAmount)) + '.' : '';
    const expiry = new Date(q.expiresAt).toLocaleDateString('es-AR');
    return [
      'Hola, ' + q.clientName + ' 👋 Te paso el presupuesto de ' + business + (productsText ? ' por ' + productsText + '.' : '.'),
      '',
      'Total con envío: ' + formatCurrency(q.total),
      [discountText, shippingText].filter(Boolean).join(' '),
      '',
      'Podés ver el detalle acá: ' + shareUrl(q),
      q.number + ' · Válido hasta el ' + expiry + '.',
      '',
      'Si te sirve, respondeme por acá y coordinamos.',
    ].join('\n');
  };

  const openShare = (q: Quote) => {
    setSharingQuote(q);
    setWhatsAppMessage(makeWhatsAppMessage(q));
    setCopied(false);
    setIsShareOpen(true);
  };

  const handleCopyLink = async () => {
    if (!sharingQuote) return;
    await navigator.clipboard.writeText(shareUrl(sharingQuote));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openPreview = (q: Quote, fromForm = false) => {
    setPreviewQuote(q);
    setPreviewUsesForm(fromForm);
    setPreviewTab('customer');
    setIsPreviewOpen(true);
    setIsModalOpen(false);
  };

  const closePreview = () => {
    setIsPreviewOpen(false);
    setPreviewPdfUrl(current => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (previewUsesForm) setIsModalOpen(true);
    setPreviewUsesForm(false);
  };

  const preparePreviewPdf = async () => {
    if (!previewQuote) return null;
    const blob = await buildQuotePdfBlob(previewQuote, catalogConfig?.businessName || 'RivaTech', '$', catalogConfig?.logoUrl);
    const url = URL.createObjectURL(blob);
    setPreviewPdfUrl(current => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });
    return url;
  };

  const showPreviewPdf = async () => {
    setPreviewTab('pdf');
    try {
      await preparePreviewPdf();
    } catch (error) {
      console.error('[Quotes] Error al generar PDF:', error);
      alert('No se pudo generar el PDF del presupuesto.');
    }
  };

  const downloadPreviewPdf = async () => {
    try {
      const url = previewPdfUrl || await preparePreviewPdf();
      if (!url || !previewQuote) return;
      const link = document.createElement('a');
      link.href = url;
      link.download = previewQuote.number + '.pdf';
      link.click();
    } catch (error) {
      console.error('[Quotes] Error al descargar PDF:', error);
      alert('No se pudo descargar el PDF del presupuesto.');
    }
  };

  const handleRenewQuote = async (quote: Quote) => {
    if (!user || !canWrite) return;
    if (!confirm('¿Renovar ' + quote.number + ' por ' + quote.validDays + ' días desde hoy?')) return;
    try {
      await db.update<Quote>('quotes', quote.id, {
        expiresAt: addDays(quote.validDays),
        status: quote.status === 'expired' ? 'sent' : quote.status,
        updatedAt: new Date().toISOString(),
      });
      await fetchData();
    } catch (error) {
      console.error('[Quotes] Error al renovar:', error);
      alert(error instanceof Error ? error.message : 'No se pudo renovar el presupuesto.');
    }
  };

  const handleShareByWhatsApp = () => {
    window.open('https://wa.me/?text=' + encodeURIComponent(whatsAppMessage), '_blank', 'noopener,noreferrer');
  };

  const handleAddSelectedFromPreview = () => {
    if (!selectedProduct || !previewUsesForm) return;
    handleAddItem();
    setIsPreviewOpen(false);
    setIsModalOpen(true);
    setPreviewUsesForm(false);
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
      const isPaid = convertMode === 'paid';
      await callRpc('convert_quote_to_sale_with_shipping', {
        p_quote_id:       convertingQuote.id,
        p_status:         isPaid ? 'Pagado' : 'Pendiente',
        p_payment_method: isPaid ? convertMethod : null,
      });
      setIsConvertOpen(false);
      setConvertingQuote(null);
      fetchData();
      alert('Presupuesto convertido a venta exitosamente.');
    } catch (error) {
      console.error('Error al convertir presupuesto:', error);
      alert(error instanceof Error ? error.message : 'Error al convertir el presupuesto.');
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
    <div className="business-page operational-page space-y-6">
      {isMobile ? <MobileQuotes
        quotes={quotes}
        filteredQuotes={filteredQuotes}
        statusFilter={statusFilter}
        search={search}
        canWrite={canWrite}
        canDelete={canDelete}
        onSearch={setSearch}
        onStatusFilter={setStatusFilter}
        onNew={openNew}
        onEdit={openEdit}
        onPreview={quote => openPreview(quote)}
        onShare={openShare}
        onRenew={handleRenewQuote}
        onConvert={openConvert}
        onDelete={setQuoteToDelete}
        effectiveStatus={getEffectiveStatus}
      /> : <>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Presupuestos</h1>
            <p className="text-slate-500 dark:text-slate-400">Creá, revisá y compartí presupuestos con tus clientes.</p>
          </div>
          <button type="button" onClick={openNew} disabled={!canWrite} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 font-semibold text-white shadow-lg shadow-indigo-500/20 disabled:opacity-50">
            <Plus size={18} /> Nuevo presupuesto
          </button>
        </header>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
            <Search size={17} className="shrink-0 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por cliente o número..." className="min-w-0 flex-1 bg-transparent text-sm outline-none dark:text-white" />
          </label>
          <div className="relative">
            <Filter size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'all' | QuoteStatus)} className="min-h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-white">
              <option value="all">Todos los estados</option>
              <option value="draft">Borrador</option>
              <option value="sent">Enviado</option>
              <option value="accepted">Aceptado</option>
              <option value="rejected">Rechazado</option>
              <option value="expired">Vencido</option>
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr><th className="px-5 py-3">Número</th><th className="px-5 py-3">Cliente</th><th className="px-5 py-3">Total</th><th className="px-5 py-3">Estado</th><th className="px-5 py-3">Vencimiento</th><th className="px-5 py-3 text-right">Acciones</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pagination.rows.map(quote => {
                  const status = getEffectiveStatus(quote);
                  const expires = new Date(quote.expiresAt);
                  const daysLeft = Math.ceil((expires.getTime() - Date.now()) / 86400000);
                  return <tr key={quote.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-4">
                      <button type="button" onClick={() => openPreview(quote)} className="font-bold text-indigo-700 hover:underline dark:text-indigo-300">{quote.number}</button>
                      <p className="text-xs text-slate-400">{quote.items.length} {quote.items.length === 1 ? 'producto' : 'productos'}</p>
                    </td>
                    <td className="px-5 py-4"><p className="font-medium text-slate-900 dark:text-white">{quote.clientName}</p>{quote.clientPhone && <p className="text-xs text-slate-400">{quote.clientPhone}</p>}</td>
                    <td className="px-5 py-4 font-bold text-slate-900 dark:text-white">{formatCurrency(quote.total)}{quote.discount > 0 && <span className="ml-1 text-xs font-semibold text-emerald-600">−{quote.discount}%</span>}</td>
                    <td className="px-5 py-4"><span className={cn('rounded-full px-2.5 py-1 text-[10px] font-bold uppercase', STATUS_COLORS[status])}>{STATUS_LABELS[status]}</span></td>
                    <td className="px-5 py-4 text-xs text-slate-600 dark:text-slate-400">{expires.toLocaleDateString('es-AR')}{daysLeft > 0 && daysLeft <= 3 && !['accepted', 'rejected'].includes(status) && <span className="ml-1 font-bold text-amber-600">· {daysLeft}d</span>}</td>
                    <td className="px-5 py-4"><div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openPreview(quote)} title="Vista previa" className="rounded-lg p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-slate-800"><Eye size={17} /></button>
                      <button type="button" onClick={() => openShare(quote)} title="Compartir" disabled={!canWrite} className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-40"><Share2 size={17} /></button>
                      <button type="button" onClick={() => openEdit(quote)} title="Editar" disabled={!canWrite} className="rounded-lg p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40"><Edit2 size={17} /></button>
                      {!['accepted', 'rejected'].includes(status) && <button type="button" onClick={() => handleRenewQuote(quote)} title="Renovar presupuesto" disabled={!canWrite} className="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-40"><RefreshCw size={16} /></button>}
                      {status === 'accepted' && !quote.convertedToSaleId && <button type="button" onClick={() => openConvert(quote)} title="Convertir a venta" disabled={!canWrite} className="rounded-lg p-2 text-slate-400 hover:text-emerald-600 disabled:opacity-40"><ArrowRight size={17} /></button>}
                      <button type="button" onClick={() => handleDelete(quote)} title="Eliminar" disabled={!canDelete} className="rounded-lg p-2 text-slate-400 hover:text-rose-600 disabled:opacity-40"><Trash2 size={16} /></button>
                    </div></td>
                  </tr>;
                })}
                {filteredQuotes.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-500">{quotes.length === 0 ? 'Todavía no creaste presupuestos.' : 'No hay presupuestos que coincidan con los filtros.'}</td></tr>}
              </tbody>
            </table>
            <Pagination {...pagination} />
          </div>
        </section>
      </>}

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); resetForm(); }} title={editingQuote ? 'Editar ' + editingQuote.number : 'Nuevo presupuesto'} className="max-w-4xl">
        <form onSubmit={handleSave} className="flex max-h-[82dvh] flex-col">
          <div className="min-h-0 space-y-5 overflow-y-auto px-1 pb-5">
            <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Datos del presupuesto</h3>
              <div className="mb-3 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
                <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Número</p><p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{editingQuote?.number || 'Se asigna al guardar'}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Fecha de emisión</p><p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{new Date(editingQuote?.createdAt || Date.now()).toLocaleDateString('es-AR')}</p></div>
              </div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Cliente</label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input autoComplete="off" value={formClientName} onChange={event => {
                  const value = event.target.value;
                  setFormClientName(value);
                  setClientSearch(value);
                  if (value !== formClientName) {
                    setFormClientId('');
                    setFormClientPhone('');
                    setFormClientEmail('');
                  }
                }} placeholder="Buscar cliente o escribir nombre" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                {clientSearch.trim() && filteredCustomers.length > 0 && <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  {filteredCustomers.map(customer => <button key={customer.id} type="button" onClick={() => handleSelectClient(customer)} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
                    <span><span className="block text-sm font-semibold text-slate-900 dark:text-white">{customer.name}</span><span className="text-xs text-slate-500">{customer.phone || customer.email || 'Cliente guardado'}</span></span><Check size={16} className="shrink-0 text-emerald-500" />
                  </button>)}
                </div>}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">{formClientId ? 'Cliente de la agenda seleccionado.' : 'Este nombre se usa solo en el presupuesto.'}</p>
                <button type="button" onClick={() => { setNewClientName(formClientName.trim()); setNewClientPhone(formClientPhone); setNewClientEmail(formClientEmail); setShowNewClientForm(value => !value); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-indigo-700 dark:border-slate-700 dark:text-indigo-300"><UserPlus size={14} /> Crear en agenda</button>
              </div>
              {formClientId && <button type="button" onClick={() => { setFormClientId(''); setFormClientPhone(''); setFormClientEmail(''); }} className="mt-2 text-xs font-semibold text-slate-500 underline">Usar solo el nombre en este presupuesto</button>}
              {showNewClientForm && <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70 sm:grid-cols-2">
                <input value={newClientName} onChange={event => setNewClientName(event.target.value)} placeholder="Nombre *" className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                <input value={newClientPhone} onChange={event => setNewClientPhone(event.target.value)} placeholder="Teléfono" className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                <input type="email" value={newClientEmail} onChange={event => setNewClientEmail(event.target.value)} placeholder="Email" className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                <div className="flex gap-2"><button type="button" onClick={() => setShowNewClientForm(false)} className="min-h-10 flex-1 rounded-lg border border-slate-200 text-sm dark:border-slate-700">Cancelar</button><button type="button" disabled={savingClient || !newClientName.trim()} onClick={handleCreateClient} className="min-h-10 flex-1 rounded-lg bg-indigo-600 text-sm font-semibold text-white disabled:opacity-50">{savingClient ? 'Guardando…' : 'Guardar en agenda'}</button></div>
              </div>}
            </section>

            <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Productos</h3>
              <div className="grid grid-cols-[minmax(0,1fr)_76px_auto] items-end gap-2">
                <div ref={productSearchRef} className="min-w-0">
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Buscar producto</label>
                  <ProductSearchSelect products={products} inventoryOwners={inventoryOwners} value={addProductId} onChange={handleSelectProduct} placeholder="Buscar producto…" />
                </div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-500">Cantidad</label><NumberField min="1" integer aria-label="Cantidad a agregar" value={addQty} onChange={event => setAddQty(Number(event.target.value))} className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-center text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></div>
                <button type="button" onClick={handleAddItem} disabled={!canWrite || !selectedProduct} className="inline-flex h-11 items-center justify-center gap-1 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white disabled:opacity-40"><Plus size={16} /> <span className="hidden sm:inline">Agregar producto</span><span className="sm:hidden">Agregar</span></button>
              </div>
              {selectedProduct && <div className="mt-3 flex flex-col gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70 sm:flex-row sm:items-center">
                <ProductThumbnail product={selectedProduct} sizeClassName="h-14 w-14" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900 dark:text-white">{selectedProduct.name}</p><p className="text-sm text-slate-600 dark:text-slate-300">{formatCurrency(addPrice)} · Stock actual: {selectedProduct.stock}</p></div>
                <div className="grid min-w-0 gap-2 sm:w-64">
                  <select aria-label="Disponibilidad del producto" value={addAvailability} onChange={event => setAddAvailability(event.target.value as NonNullable<QuoteItem['availability']>)} className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"><option value="immediate">Entrega inmediata</option><option value="on_order">Bajo pedido</option><option value="confirm">Disponibilidad a confirmar</option></select>
                  {addAvailability === 'on_order' && <input value={addLeadTime} onChange={event => setAddLeadTime(event.target.value)} placeholder="Plazo estimado (opcional)" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white" />}
                </div>
              </div>}
              <div className="mt-4">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Productos incluidos · {items.length}</h4>
                {items.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/70">Todavía no agregaste productos.</p> : <div className="space-y-2">
                  {items.map((item, index) => {
                    const product = products.find(value => value.id === item.productId);
                    return <div key={item.productId + '-' + index} className="grid grid-cols-[minmax(0,1fr)_64px_104px_auto] items-center gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                      <div className="flex min-w-0 items-center gap-2">{product && <ProductThumbnail product={product} sizeClassName="h-10 w-10" />}<div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{item.productName}</p><p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{item.availability === 'immediate' ? 'Entrega inmediata' : item.availability === 'on_order' ? 'Bajo pedido' : 'Disponibilidad a confirmar'}{item.leadTime ? ' · ' + item.leadTime : ''}</p><select aria-label={'Disponibilidad de ' + item.productName} value={item.availability || 'confirm'} onChange={event => setItems(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, availability: event.target.value as NonNullable<QuoteItem['availability']> } : line))} className="mt-1 max-w-full rounded-md border border-slate-200 bg-white px-1 py-1 text-[10px] dark:border-slate-700 dark:bg-slate-900 dark:text-white"><option value="immediate">Entrega inmediata</option><option value="on_order">Bajo pedido</option><option value="confirm">A confirmar</option></select>{item.availability === 'on_order' && <input aria-label={'Plazo estimado de ' + item.productName} value={item.leadTime || ''} onChange={event => setItems(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, leadTime: event.target.value || undefined } : line))} placeholder="Plazo" className="mt-1 ml-1 w-24 rounded-md border border-slate-200 bg-white px-1 py-1 text-[10px] dark:border-slate-700 dark:bg-slate-900 dark:text-white" />}</div></div>
                      <NumberField min="1" integer aria-label={'Cantidad de ' + item.productName} value={item.quantity} onChange={event => handleUpdateItemQty(index, Number(event.target.value))} className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-1 text-center text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                      <div className="min-w-0"><MoneyInput min="0" aria-label={'Precio unitario de ' + item.productName} value={item.unitPrice} onChange={event => handleUpdateItemPrice(index, Number(event.target.value))} className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-right text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white" /><p className="mt-1 text-right text-xs font-bold">{formatCurrency(item.subtotal)}</p></div>
                      <button type="button" aria-label={'Quitar ' + item.productName} onClick={() => handleRemoveItem(index)} className="rounded-lg p-2 text-slate-400 hover:text-rose-600"><X size={16} /></button>
                    </div>;
                  })}
                </div>}
              </div>
            </section>

            <section className="grid gap-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-700 sm:grid-cols-2">
              <div><label className="mb-1 block text-xs font-semibold text-slate-500">Descuento (%)</label><NumberField min="0" max="100" aria-label="Descuento porcentual" value={formDiscount} onChange={event => setFormDiscount(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></div>
              <React.Suspense fallback={<div className="min-h-11" aria-label="Cargando opción de envío" />}>
                <LazySaleShippingControl ownerUid={user?.uid} enabled={shippingEnabled} amount={formShippingAmount} onEnabledChange={setShippingEnabled} onAmountChange={setFormShippingAmount} />
              </React.Suspense>
              <div><label className="mb-1 block text-xs font-semibold text-slate-500">Validez</label><div className="flex gap-2">{([7, 15, 30] as const).map(days => <button key={days} type="button" onClick={() => setFormValidDays(days)} className={cn('min-h-10 flex-1 rounded-lg border text-sm font-semibold', formValidDays === days ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 dark:border-slate-700')}>{days} días</button>)}</div>{editingQuote && <p className="mt-1 text-xs text-slate-500">Vence el {new Date(editingQuote.expiresAt).toLocaleDateString('es-AR')}. Cambiar validez no modifica esta fecha.</p>}</div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-500">Estado</label><select value={formStatus} onChange={event => setFormStatus(event.target.value as QuoteStatus)} className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"><option value="draft">Borrador</option><option value="sent">Enviado</option><option value="accepted">Aceptado</option><option value="rejected">Rechazado</option></select></div>
              {editingQuote && !['accepted', 'rejected'].includes(editingQuote.status) && <div className="sm:col-span-2"><button type="button" onClick={() => setRenewalRequested(value => !value)} aria-pressed={renewalRequested} className={cn('inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold', renewalRequested ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300')}><RefreshCw size={15} /> {renewalRequested ? 'Renovación activada: vence ' + new Date(addDays(formValidDays)).toLocaleDateString('es-AR') : 'Renovar presupuesto'}</button></div>}
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Condiciones para el cliente</label><textarea value={formNotes} onChange={event => setFormNotes(event.target.value)} rows={3} placeholder="Se mostrarán en la vista del cliente y el PDF." className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></div>
              <div className="rounded-2xl border border-amber-200 p-4 dark:border-amber-900"><label className="mb-1 block text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Nota interna · privada</label><textarea value={formInternalNotes} onChange={event => setFormInternalNotes(event.target.value)} rows={3} placeholder="Solo visible para tu equipo. Nunca aparece en el enlace ni en el PDF." className="w-full resize-y rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-900 dark:bg-slate-800 dark:text-white" /></div>
            </section>
          </div>

          <footer className="sticky bottom-0 z-10 -mx-1 mt-2 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 px-1 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <div className="mr-auto min-w-[180px]"><p className="text-[10px] font-bold uppercase text-slate-500">Total con envío</p><p className="text-xl font-black text-indigo-700 dark:text-indigo-300">{formatCurrency(total)}</p><p className="text-[10px] text-slate-500">Productos {formatCurrency(subtotal)}{formDiscount > 0 ? ' · Descuento −' + formatCurrency(subtotal * formDiscount / 100) : ''}{shippingEnabled && formShippingAmount > 0 ? ' · Envío ' + formatCurrency(formShippingAmount) : ''}</p></div>
            <button type="button" onClick={() => openPreview(previewDraftQuote, true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-indigo-200 px-3 text-sm font-semibold text-indigo-700 dark:border-indigo-800 dark:text-indigo-300"><Eye size={16} /> Vista previa</button>
            <button type="submit" disabled={saving || !canWrite} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50 sm:flex-none">{saving ? 'Guardando…' : editingQuote ? 'Guardar cambios' : 'Guardar borrador'}</button>
          </footer>
        </form>
      </Modal>

      <Modal isOpen={isPreviewOpen} onClose={closePreview} title={previewQuote ? 'Vista previa · ' + previewQuote.number : 'Vista previa'} className="max-w-5xl">
        {previewQuote && <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 dark:border-slate-700">
            <button type="button" onClick={() => setPreviewTab('customer')} className={cn('min-h-10 rounded-lg px-3 text-sm font-semibold', previewTab === 'customer' ? 'bg-indigo-600 text-white' : 'border border-slate-200 dark:border-slate-700')}>Vista del cliente</button>
            <button type="button" onClick={showPreviewPdf} className={cn('min-h-10 rounded-lg px-3 text-sm font-semibold', previewTab === 'pdf' ? 'bg-indigo-600 text-white' : 'border border-slate-200 dark:border-slate-700')}><FileText size={15} className="mr-1 inline" /> Ver PDF</button>
            {previewTab === 'pdf' && previewPdfUrl && <><button type="button" onClick={downloadPreviewPdf} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold dark:border-slate-700"><Download size={15} /> Descargar</button><button type="button" onClick={() => {
              if (isMobile && previewPdfUrl) {
                window.open(previewPdfUrl, '_blank', 'noopener,noreferrer');
                return;
              }
              pdfFrameRef.current?.contentWindow?.print();
            }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold dark:border-slate-700"><Printer size={15} /> {isMobile ? 'Abrir para imprimir' : 'Imprimir'}</button></>}
            <span className="ml-auto text-xs text-slate-500">Total: <strong>{formatCurrency(previewQuote.total)}</strong></span>
          </div>
          {previewTab === 'customer' ? <div className="max-h-[65dvh] overflow-y-auto rounded-xl bg-slate-100 p-3 sm:p-5"><QuoteDocument quote={previewQuote} businessName={catalogConfig?.businessName || 'RivaTech'} currencySymbol="$" logoUrl={catalogConfig?.logoUrl} /></div> : <div className="h-[65dvh] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700">{previewPdfUrl ? (isMobile ? <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-8 text-center"><FileText size={38} className="text-indigo-500" /><div><h3 className="font-bold text-slate-800 dark:text-white">El visor integrado no funciona en este celular</h3><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">Abrí el PDF en una pestaña nueva para verlo o usar las opciones de impresión del navegador.</p></div><a href={previewPdfUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white"><FileText size={16} /> Abrir PDF</a></div> : <iframe ref={pdfFrameRef} title="Vista PDF del presupuesto" src={previewPdfUrl} className="h-full w-full" />) : <div className="grid h-full place-items-center text-sm text-slate-500">Generando PDF…</div>}</div>}
          <footer className="flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
            <div>{previewUsesForm && selectedProduct && previewTab === 'customer' && <button type="button" onClick={handleAddSelectedFromPreview} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white"><Plus size={15} /> Agregar este producto al presupuesto</button>}</div>
            <div className="flex gap-2"><button type="button" onClick={closePreview} className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold dark:border-slate-700">{previewUsesForm ? 'Volver a editar' : 'Cerrar'}</button>{!previewUsesForm && <button type="button" onClick={() => { openEdit(previewQuote); setIsPreviewOpen(false); }} disabled={!canWrite} className="min-h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-50">Editar</button>}</div>
          </footer>
        </div>}
      </Modal>

      <Modal isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} title="Revisar mensaje de WhatsApp" className="max-w-xl">
        {sharingQuote && <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800"><p className="font-bold text-slate-900 dark:text-white">{catalogConfig?.businessName || 'RivaTech'} · {sharingQuote.number}</p><p className="mt-1 text-slate-500">{sharingQuote.items.map(item => item.productName).join(', ')} · {formatCurrency(sharingQuote.total)}</p></div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Mensaje editable<textarea value={whatsAppMessage} onChange={event => setWhatsAppMessage(event.target.value)} rows={10} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setIsShareOpen(false)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold dark:border-slate-700">Cancelar</button><button type="button" onClick={handleCopyLink} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold dark:border-slate-700">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Link copiado' : 'Copiar enlace'}</button><button type="button" onClick={handleShareByWhatsApp} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white"><MessageCircle size={16} /> Abrir WhatsApp</button></div>
          {sharingQuote.clientEmail && <a href={'mailto:' + sharingQuote.clientEmail + '?subject=' + encodeURIComponent('Presupuesto ' + sharingQuote.number) + '&body=' + encodeURIComponent(whatsAppMessage)} className="block text-right text-xs font-semibold text-indigo-600 hover:underline">Preparar correo electrónico</a>}
        </div>}
      </Modal>

      <Modal isOpen={Boolean(quoteToDelete)} onClose={() => setQuoteToDelete(null)} title="Eliminar presupuesto" className="max-w-md">
        {quoteToDelete && <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">¿Querés eliminar el presupuesto {quoteToDelete.number} de {quoteToDelete.clientName}?</p>
          {quoteToDelete.convertedToSaleId && <p className="text-sm text-amber-700 dark:text-amber-300">Este presupuesto ya se convirtió en una venta. También podés borrar esa venta.</p>}
          <div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={() => setQuoteToDelete(null)} className="min-h-11 flex-1 rounded-xl border border-slate-200 px-4 font-semibold">Cancelar</button><button type="button" onClick={() => handleMobileDelete(false)} className="min-h-11 flex-1 rounded-xl bg-rose-600 px-4 font-semibold text-white">Eliminar presupuesto</button>{quoteToDelete.convertedToSaleId && <button type="button" onClick={() => handleMobileDelete(true)} className="min-h-11 flex-1 rounded-xl bg-rose-800 px-4 font-semibold text-white">Eliminar también la venta</button>}</div>
        </div>}
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
