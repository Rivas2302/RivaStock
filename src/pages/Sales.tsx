import { lazyWithRetry } from '../lib/lazyWithRetry';
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { usePagination } from '../hooks/usePagination';
import Pagination from '../components/Pagination';
import { useAuth } from '../AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePermission } from '../hooks/usePermission';
import { useInventoryOwners } from '../hooks/useInventoryOwners';
import { db, callRpc } from '../lib/db';
import { formatFinancialAmount as formatCurrency, roundFinancialAmount as roundPrice, buildSaleSettlements } from '../lib/financialSettlement';
import {
  Product, Sale, Customer, CustomerTransaction, InventoryHolding,
  SaleItemAllocation, SaleItemSnapshot,
} from '../types';
import { filterOwnInventoryProducts } from '../lib/ownInventory';
import { cn, formatDate, todayString } from '../lib/utils';
import {
  Plus,
  ScanLine,
  Search,
  Filter,
  Edit2,
  Trash2,
  Download,
  CheckCircle2,
  CreditCard,
  Clock,
  ChevronDown,
  ShoppingCart,
  UserCheck,
  UserPlus,
  X,
  FileSpreadsheet,
  FileDown,
} from 'lucide-react';
import Modal from '../components/Modal';
import NumberField from '../components/NumberField';
import MoneyInput from '../components/MoneyInput';
import ProductSearchSelect from '../components/ProductSearchSelect';
import ProductThumbnail from '../components/stock/ProductThumbnail';
import AdjustmentInput from '../components/AdjustmentInput';
import { motion } from 'motion/react';
import {
  getSalesPageEditPlan,
  isPendingSaleStatus,
  isQuoteSale,
} from '../lib/sales';
import { exportWorkbookToExcel, exportToPDF } from '../lib/exportUtils';
import { showToast } from '../lib/toast';
import { calculateTotalWithShipping } from '../lib/saleShipping';
import {
  buildAttributedSaleCommandItems,
  getSaleRefundEligibility,
  hasFullOperableAttributedSaleScope,
  projectAttributedSales,
  resolveAttributedSaleCustomerId,
  shouldRenderSalesMutationActions,
  type OwnerSaleProjection,
} from '../lib/attributedSales';
import { getInventoryHoldings } from '../lib/inventoryHoldings';
import { resolveIdempotencyIntent, type IdempotencyIntent } from '../lib/idempotencyIntent';
import { calculateSaleTotals } from '../lib/salesTotals';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileSalesList from '../components/sales/MobileSalesList';

const LazySaleShippingControl = lazyWithRetry('src/components/SaleShippingControl.tsx', () => import('../components/SaleShippingControl'));
const SALE_COLUMNS = 'id,user_id,date,created_at,product_id,product_name,unit_price,quantity,adjustment,shipping_amount,total,status,payment_method,client,items,source';
const CUSTOMER_COLUMNS = 'id,user_id,name,name_lower,phone,email,notes,current_balance,created_at,updated_at';
const CUSTOMER_TRANSACTION_COLUMNS = 'id,user_id,customer_id,type,amount,description,payment_method,related_sale_id,related_quote_id,account_payment,financial_command_id,date,created_at';
const SALE_ITEM_PROJECTION_COLUMNS = 'id,sale_id_snapshot,reversed_at';
const SALE_ALLOCATION_PROJECTION_COLUMNS = 'id,sale_id_snapshot,sale_item_id,inventory_owner_id_snapshot,inventory_owner_name_snapshot,product_id_snapshot,product_name_snapshot,quantity,unit_price,discount_share,adjustment_share,revenue_share,cost_share,allocation_source,reversed_at';

type SalesPeriodPreset = 'today' | 'week' | 'month' | 'custom' | 'all';
type SalesInsight = 'sold' | 'profit' | 'pending';

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSalesDateRange(preset: SalesPeriodPreset, customFrom: string, customTo: string) {
  const today = todayString();
  const now = new Date();
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { from: localDateKey(start), to: today };
  }
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === 'custom') {
    const from = customFrom || customTo || today;
    const to = customTo || customFrom || today;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  return { from: '', to: '' };
}

function formatSalesRange(range: { from: string; to: string }, preset: SalesPeriodPreset) {
  if (preset === 'all') return 'Todo el historial';
  if (preset === 'today') return `Hoy · ${formatDate(range.from)}`;
  if (preset === 'week') return `Esta semana · ${formatDate(range.from)} al ${formatDate(range.to)}`;
  if (preset === 'month') return `Este mes · ${formatDate(range.from)} al ${formatDate(range.to)}`;
  return `${formatDate(range.from)} al ${formatDate(range.to)}`;
}

function getSaleTicketLabel(saleId: string) {
  return saleId.slice(0, 8).toUpperCase();
}

export default function Sales() {
  const isMobile = useIsMobile();
  useEffect(() => { void LazySaleShippingControl.preload().catch(() => undefined); }, []);
  const {
    user, refetchToken, holdingsEnabled, inventoryAccessError, allowedInventoryOwnerIds,
    operableInventoryOwnerIds, defaultInventoryOwnerId,
  } = useAuth();
  const { owners: inventoryOwners } = useInventoryOwners(
    user?.uid,
    refetchToken,
    allowedInventoryOwnerIds,
  );
  const canWrite = usePermission('ventas', 'write');
  const canDelete = usePermission('ventas', 'delete');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSaleId = searchParams.get('sale');
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [holdings, setHoldings] = useState<InventoryHolding[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItemSnapshot[]>([]);
  const [saleAllocations, setSaleAllocations] = useState<SaleItemAllocation[]>([]);
  const [customerTransactions, setCustomerTransactions] = useState<CustomerTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') ?? 'all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const deferredSearch = useDeferredValue(search);

  // Cuenta corriente
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [creditSearch, setCreditSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showNewCustInline, setShowNewCustInline] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [savingNewCust, setSavingNewCust] = useState(false);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [paymentCorrectionOnly, setPaymentCorrectionOnly] = useState(false);
  const [formData, setFormData] = useState<Partial<Sale>>({
    date: todayString(),
    productId: '',
    quantity: 1,
    unitPrice: 0,
    adjustment: 0,
    shippingAmount: 0,
    status: 'Pagado',
    paymentMethod: 'Efectivo',
    client: ''
  });

  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  const openNewSale = () => {
    setEditingSale(null);
    setPaymentCorrectionOnly(false);
    setFormData({ date: todayString(), productId: '', quantity: 1, unitPrice: 0, adjustment: 0, shippingAmount: 0, status: 'Pagado', paymentMethod: 'Efectivo', client: '' });
    setShippingEnabled(false);
    setIsCreditSale(false);
    setCreditSearch('');
    setSelectedCustomer(null);
    setShowNewCustInline(false);
    setNewCustName('');
    setNewCustPhone('');
    setPreferredOwnerId('');
    setIsModalOpen(true);
  };

  useEffect(() => {
    if (searchParams.get('action') !== 'new' || !canWrite) return;
    openNewSale();
    const next = new URLSearchParams(searchParams);
    next.delete('action');
    setSearchParams(next, { replace: true });
  }, [canWrite, searchParams, setSearchParams]);

  useEffect(() => {
    if (!requestedSaleId || !sales.some(sale => sale.id === requestedSaleId)) return;
    setExpandedSaleId(requestedSaleId);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`sale-ticket-${requestedSaleId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedSaleId, sales]);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [preferredOwnerId, setPreferredOwnerId] = useState<string>('');
  const [shippingEnabled, setShippingEnabled] = useState(false);
  const registerIntentRef = useRef<IdempotencyIntent | null>(null);
  const editIntentRef = useRef<IdempotencyIntent | null>(null);
  const refundIntentRef = useRef<IdempotencyIntent | null>(null);
  const statusIntentRef = useRef<IdempotencyIntent | null>(null);
  const [statusSavingSaleId, setStatusSavingSaleId] = useState<string | null>(null);
  const [periodPreset, setPeriodPreset] = useState<SalesPeriodPreset>('month');
  const [customFrom, setCustomFrom] = useState(() => `${todayString().slice(0, 7)}-01`);
  const [customTo, setCustomTo] = useState(todayString());
  const [zeroOnly, setZeroOnly] = useState(false);
  const [activeInsight, setActiveInsight] = useState<SalesInsight | null>(null);
  const [showCollectionsModal, setShowCollectionsModal] = useState(false);
  const [editingLineIndex, setEditingLineIndex] = useState<number | null>(null);
  const [collectionsFrom, setCollectionsFrom] = useState(todayString());
  const [collectionsTo, setCollectionsTo] = useState(todayString());
  const renderCreationActions = shouldRenderSalesMutationActions(
    holdingsEnabled,
    operableInventoryOwnerIds.length > 0,
  );

  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  const excelDate = (value: string) => {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  };

  const paymentForSale = (sale: OwnerSaleProjection) => {
    const settlement = settlements.get(sale.id);
    const original = salesById.get(sale.id);
    const fullTotal = settlement?.total ?? original?.total ?? sale.total;
    const fraction = fullTotal > 0 ? sale.total / fullTotal : 0;
    return {
      collected: roundPrice((settlement?.paid ?? 0) * fraction),
      pending: roundPrice((settlement?.pending ?? 0) * fraction),
    };
  };

  const handleExportExcel = async () => {
    if (!user || exporting) return;
    setExporting(true);
    try {
      const generatedAt = todayString();
      const saleRows = filteredSales.map(sale => {
        const payment = paymentForSale(sale);
        const ownerNames = sale.ownerNames.join(', ') || 'Principal';
        return [
          getSaleTicketLabel(sale.id), excelDate(sale.date), sale.client || 'Sin cliente',
          ownerNames, roundPrice(sale.total), payment.collected, payment.pending,
          sale.status, sale.paymentMethod || 'Sin método',
        ];
      });
      const productRows = filteredSales.flatMap(sale => {
        const originalProjection = projectedSales.find(candidate => candidate.id === sale.id) ?? sale;
        const baseSubtotal = originalProjection.items.reduce(
          (sum, item) => sum + item.quantity * item.unitPrice - item.discount, 0,
        );
        return sale.items.map(item => {
          const lineSubtotal = item.quantity * item.unitPrice - item.discount;
          const adjustmentShare = holdingsEnabled
            ? item.adjustment
            : baseSubtotal !== 0 ? (sales.find(candidate => candidate.id === sale.id)?.adjustment ?? 0) * lineSubtotal / baseSubtotal : 0;
          const subtotal = holdingsEnabled ? item.revenue : lineSubtotal + adjustmentShare;
          return [
            getSaleTicketLabel(sale.id), excelDate(sale.date), item.productName,
            item.quantity, roundPrice(item.unitPrice), roundPrice(item.discount + adjustmentShare), roundPrice(subtotal),
          ];
        });
      });
      const summaryRows: Array<Array<string | number | Date | null>> = [
        ['Indicador', 'Valor'],
        ['Negocio', user.businessName],
        ['Período', reportPeriodLabel],
        ['Filtros', filterLabel],
        ['Vendido', roundPrice(totalSold)],
        ['Cobrado de estas ventas', roundPrice(totalCollected)],
        ['Pendiente de cobro', roundPrice(totalPending)],
        ['Ganancia bruta con costo histórico', costAvailableCount ? roundPrice(grossProfit) : 'Sin datos de costo'],
        ['Tickets', ticketCount],
        ['Unidades', unitCount],
        ['Ventas con costo histórico disponible', costAvailableCount + ' de ' + ticketCount],
      ];
      await exportWorkbookToExcel([
        { name: 'Resumen', rows: summaryRows, widths: [38, 36], headerRows: 0, moneyCells: [[4, 1], [5, 1], [6, 1], [7, 1]] },
        {
          name: 'Ventas',
          rows: [
            ['Ticket', 'Fecha', 'Cliente', 'Titular / alcance', 'Total', 'Cobrado', 'Saldo pendiente', 'Estado', 'Medio de pago'],
            ...saleRows,
          ],
          widths: [14, 14, 26, 28, 16, 16, 18, 16, 20],
          moneyColumns: [4, 5, 6],
          dateColumns: [1],
        },
        {
          name: 'Productos vendidos',
          rows: [
            ['Ticket', 'Fecha', 'Producto', 'Cantidad', 'Precio unitario', 'Ajustes', 'Subtotal de productos'],
            ...productRows,
          ],
          widths: [14, 14, 34, 12, 18, 16, 22],
          moneyColumns: [4, 5, 6],
          dateColumns: [1],
        },
      ], 'ventas-' + generatedAt + '.xlsx', user.currencySymbol);
      setShowExportMenu(false);
    } catch {
      showToast('No se pudo exportar el archivo Excel.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPDF = async (mode: 'summary' | 'detail' = 'detail') => {
    if (!user || exporting) return;
    setExporting(true);
    try {
      const generatedAt = todayString();
      const summaryRows: Array<[string, string]> = [
        ['Total vendido', formatCurrency(totalSold)],
        ['Cobrado de estas ventas', formatCurrency(totalCollected)],
        ['Pendiente de cobro', formatCurrency(totalPending)],
        ['Tickets y unidades', ticketCount + ' tickets · ' + unitCount + ' unidades'],
        ['Ganancia bruta', costAvailableCount ? formatCurrency(grossProfit) : 'Sin datos de costo histórico'],
        ['Costo histórico disponible', costAvailableCount + ' de ' + ticketCount + ' ventas'],
      ];
      await exportToPDF({
        businessName: user.businessName,
        currencySymbol: user.currencySymbol,
        rangeLabel: reportPeriodLabel,
      }, {
        title: mode === 'summary' ? 'Resumen de ventas' : 'Detalle de ventas',
        summaryOnly: mode === 'summary',
        filtersLabel: filterLabel,
        summaryRows,
        columns: [
          { header: 'Ticket', dataKey: 'ticket' },
          { header: 'Fecha', dataKey: 'fecha' },
          { header: 'Producto', dataKey: 'producto' },
          { header: 'Cliente', dataKey: 'cliente' },
          { header: 'Cant.', dataKey: 'cantidad' },
          { header: 'Total', dataKey: 'total' },
          { header: 'Cobrado', dataKey: 'cobrado' },
          { header: 'Saldo', dataKey: 'pendiente' },
          { header: 'Estado', dataKey: 'estado' },
        ],
        rows: mode === 'detail' ? filteredSales.map(sale => {
          const payment = paymentForSale(sale);
          return {
            ticket: getSaleTicketLabel(sale.id),
            fecha: formatDate(sale.date),
            producto: sale.productName,
            cliente: sale.client || '-',
            cantidad: sale.quantity,
            total: formatCurrency(roundPrice(sale.total)),
            cobrado: formatCurrency(payment.collected),
            pendiente: formatCurrency(payment.pending),
            estado: sale.status,
          };
        }) : [],
        fileName: 'ventas-' + (mode === 'summary' ? 'resumen-' : 'detalle-') + generatedAt + '.pdf',
      });
      setShowExportMenu(false);
    } catch {
      showToast('No se pudo exportar el PDF.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const filteredCreditCustomers = useMemo(() => {
    const q = creditSearch.toLowerCase();
    if (!q) return [];
    return customers.filter(c => c.nameLower.includes(q)).slice(0, 5);
  }, [customers, creditSearch]);
  const selectedProductOwnerOptions = useMemo(() => inventoryOwners.filter((owner) => (
    operableInventoryOwnerIds.includes(owner.id)
    && holdings.some((holding) => (
      holding.productId === formData.productId
      && holding.inventoryOwnerId === owner.id
      && holding.active
      && holding.stock > 0
    ))
  )), [formData.productId, holdings, inventoryOwners, operableInventoryOwnerIds]);


  const fetchData = async () => {
    if (!user) return;
    const [
      salesResult, productsResult, customersResult, customerTransactionsResult,
      itemsResult, allocationsResult, holdingsResult,
    ] = await Promise.allSettled([
      db.listAllColumns<Sale>('sales', user.uid, SALE_COLUMNS),
      db.list<Product>('products', user.uid),
      db.listAllColumns<Customer>('customers', user.uid, CUSTOMER_COLUMNS),
      db.listAllColumns<CustomerTransaction>('customer_transactions', user.uid, CUSTOMER_TRANSACTION_COLUMNS),
      holdingsEnabled ? db.listAllColumns<SaleItemSnapshot>('sale_items', user.uid, SALE_ITEM_PROJECTION_COLUMNS) : Promise.resolve([]),
      holdingsEnabled ? db.listAllColumns<SaleItemAllocation>('sale_item_allocations', user.uid, SALE_ALLOCATION_PROJECTION_COLUMNS) : Promise.resolve([]),
      holdingsEnabled ? getInventoryHoldings(user.uid) : Promise.resolve([]),
    ]);

    if (
      salesResult.status === 'rejected'
      || customerTransactionsResult.status === 'rejected'
      || (holdingsEnabled && (
        itemsResult.status === 'rejected'
        || allocationsResult.status === 'rejected'
        || holdingsResult.status === 'rejected'
      ))
    ) {
      console.error('No se pudo verificar la atribucion de ventas');
      setLoadError('No se pudieron verificar las ventas y sus pagos.');
      setSales([]);
      setSaleItems([]);
      setSaleAllocations([]);
      setHoldings([]);
      setCustomerTransactions([]);
      setLoading(false);
      return;
    }

    setLoadError(null);
    setSales(salesResult.value.sort((a, b) => {
      const dc = b.date.localeCompare(a.date);
      if (dc !== 0) return dc;
      return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
    }));

    if (productsResult.status === 'fulfilled') {
      setProducts(filterOwnInventoryProducts(productsResult.value));
    } else {
      console.error('Error al cargar productos:', productsResult.reason);
    }

    if (customersResult.status === 'fulfilled') {
      setCustomers(customersResult.value);
    } else {
      console.error('Error al cargar clientes:', customersResult.reason);
    }
    if (customerTransactionsResult.status === 'fulfilled') {
      setCustomerTransactions(customerTransactionsResult.value);
    }
    if (itemsResult.status === 'fulfilled') setSaleItems(itemsResult.value);
    if (allocationsResult.status === 'fulfilled') setSaleAllocations(allocationsResult.value);
    if (holdingsResult.status === 'fulfilled') setHoldings(holdingsResult.value);

    setLoading(false);
  };

  useEffect(() => {
    if (!user || inventoryAccessError) {
      setSales([]);
      setSaleItems([]);
      setSaleAllocations([]);
      setHoldings([]);
      setCustomerTransactions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [
        salesResult, productsResult, customersResult, customerTransactionsResult,
        itemsResult, allocationsResult, holdingsResult,
      ] = await Promise.allSettled([
        db.listAllColumns<Sale>('sales', user.uid, SALE_COLUMNS),
        db.list<Product>('products', user.uid),
        db.listAllColumns<Customer>('customers', user.uid, CUSTOMER_COLUMNS),
        db.listAllColumns<CustomerTransaction>('customer_transactions', user.uid, CUSTOMER_TRANSACTION_COLUMNS),
        holdingsEnabled ? db.listAllColumns<SaleItemSnapshot>('sale_items', user.uid, SALE_ITEM_PROJECTION_COLUMNS) : Promise.resolve([]),
        holdingsEnabled ? db.listAllColumns<SaleItemAllocation>('sale_item_allocations', user.uid, SALE_ALLOCATION_PROJECTION_COLUMNS) : Promise.resolve([]),
        holdingsEnabled ? getInventoryHoldings(user.uid) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      if (
        salesResult.status === 'rejected'
      || customerTransactionsResult.status === 'rejected'
        || (holdingsEnabled && (
          itemsResult.status === 'rejected'
          || allocationsResult.status === 'rejected'
          || holdingsResult.status === 'rejected'
        ))
      ) {
        console.error('No se pudo verificar la atribucion de ventas');
        setLoadError('No se pudieron verificar las ventas y sus pagos.');
        setSales([]);
        setSaleItems([]);
        setSaleAllocations([]);
        setHoldings([]);
        setCustomerTransactions([]);
        setLoading(false);
        return;
      }
      if (salesResult.status === 'fulfilled') {
        setLoadError(null);
        setSales(salesResult.value.sort((a, b) => {
          const dc = b.date.localeCompare(a.date);
          if (dc !== 0) return dc;
          return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
        }));
      }
      if (productsResult.status === 'fulfilled') setProducts(filterOwnInventoryProducts(productsResult.value));
      if (customersResult.status === 'fulfilled') setCustomers(customersResult.value);
      if (customerTransactionsResult.status === 'fulfilled') {
        setCustomerTransactions(customerTransactionsResult.value);
      }
      if (itemsResult.status === 'fulfilled') setSaleItems(itemsResult.value);
      if (allocationsResult.status === 'fulfilled') setSaleAllocations(allocationsResult.value);
      if (holdingsResult.status === 'fulfilled') setHoldings(holdingsResult.value);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [holdingsEnabled, inventoryAccessError, refetchToken, user]);

  const handleProductChange = (productId: string) => {
    if (!productId) {
      setFormData(prev => ({ ...prev, productId: '', productName: '' }));
      setPreferredOwnerId('');
      return;
    }
    const product = products.find(p => p.id === productId);
    if (product) {
      setPreferredOwnerId('');
      setFormData(prev => ({
        ...prev,
        productId,
        productName: product.name,
        unitPrice: roundPrice(product.salePrice)
      }));
    }
  };

  const saleTotals = calculateSaleTotals(
    Number(formData.quantity) || 0,
    Number(formData.unitPrice) || 0,
    Number(formData.adjustment) || 0,
  );
  const saleTotalWithShipping = calculateTotalWithShipping(
    saleTotals.total,
    shippingEnabled,
    Number(formData.shippingAmount) || 0,
  );
  const isMultiItemPosEdit = editingSale?.source === 'pos' && (editingSale.items?.length ?? 0) > 1;
  const editingLineItems = isMultiItemPosEdit ? (formData.items ?? []) : [];
  const multiItemSubtotal = editingLineItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const multiItemDiscount = editingLineItems.reduce((sum, item) => sum + item.quantity * (item.discount ?? 0), 0);
  const multiItemTotal = Math.max(0, roundPrice(multiItemSubtotal - multiItemDiscount + (Number(formData.adjustment) || 0)));
  const formTotalWithShipping = isMultiItemPosEdit
    ? roundPrice(multiItemTotal + (shippingEnabled ? Number(formData.shippingAmount) || 0 : 0))
    : saleTotalWithShipping;

  const saleMutationDenialReason = (
    sale: Sale,
    projection?: OwnerSaleProjection,
  ): string | null => {
    if (sale.source === 'quote') {
      return 'Las ventas creadas desde presupuestos se gestionan desde el presupuesto original.';
    }
    if (!holdingsEnabled) return null;
    if (projection?.isPartial) {
      return 'La operacion requiere acceso operativo al ticket completo.';
    }
    const eligibility = getSaleRefundEligibility(
      sale,
      saleAllocations,
      operableInventoryOwnerIds,
      true,
      saleItems,
    );
    if ('reason' in eligibility) {
      return 'La operacion requiere acceso operativo a todos los titulares atribuidos.';
    }
    return null;
  };

  const projectedSaleMutationDenialReason = (projection: OwnerSaleProjection): string | null => {
    const sale = sales.find((candidate) => candidate.id === projection.id);
    return sale ? saleMutationDenialReason(sale, projection) : 'Venta no encontrada.';
  };

  const ticketHasFullOperableScope = (projection: OwnerSaleProjection): boolean => {
    const sale = sales.find((candidate) => candidate.id === projection.id);
    return Boolean(sale && hasFullOperableAttributedSaleScope(
      sale,
      saleAllocations,
      operableInventoryOwnerIds,
      holdingsEnabled,
      saleItems,
    ) && !projection.isPartial);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || saving) return;
    if (inventoryAccessError) {
      alert(inventoryAccessError);
      return;
    }
    setSaving(true);

    try {
      if (editingSale && isQuoteSale(editingSale)) {
        alert('Las ventas creadas desde presupuestos se editan desde el presupuesto original.');
        return;
      }

      if (editingSale && paymentCorrectionOnly) {
        if (protectedSaleIds.has(editingSale.id)) {
          alert('Este ticket tiene pagos de cuenta corriente y no se puede corregir desde esta acción.');
          return;
        }
        if (holdingsEnabled) {
          const currentItems = editingSale.items?.length ? editingSale.items.map(item => ({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.price,
            lineDiscount: item.discount ?? 0,
          })) : [{
            productId: editingSale.productId,
            productName: editingSale.productName,
            quantity: editingSale.quantity,
            unitPrice: editingSale.unitPrice,
            lineDiscount: 0,
          }];
          const payload = {
            p_sale_id: editingSale.id,
            p_items: buildAttributedSaleCommandItems(currentItems),
            p_adjustment_total: editingSale.adjustment ?? 0,
            p_status: 'Pagado',
            p_payment_method: formData.paymentMethod ?? null,
            p_customer_id: resolveAttributedSaleCustomerId(editingSale.id, null, customerTransactions),
            p_client: editingSale.client ?? null,
            p_date: editingSale.date,
            p_shipping_amount: editingSale.shippingAmount ?? 0,
          };
          editIntentRef.current = resolveIdempotencyIntent('sale:edit', payload, editIntentRef.current);
          await callRpc('edit_attributed_sale_with_shipping', { ...payload, p_idempotency_key: editIntentRef.current.key });
          editIntentRef.current = null;
        } else if (editingSale.source === 'pos') {
          const items = editingSale.items?.length ? editingSale.items.map(item => ({
            productId: item.productId, quantity: item.quantity, unitPrice: item.price, lineDiscount: item.discount ?? 0,
          })) : [{
            productId: editingSale.productId, quantity: editingSale.quantity, unitPrice: editingSale.unitPrice, lineDiscount: 0,
          }];
          await callRpc('edit_pos_sale_with_shipping', {
            p_sale_id: editingSale.id,
            p_new_items: items,
            p_new_adjustment: editingSale.adjustment ?? 0,
            p_new_status: 'Pagado',
            p_new_payment_method: formData.paymentMethod ?? null,
            p_new_customer_id: null,
            p_new_date: editingSale.date,
            p_shipping_amount: editingSale.shippingAmount ?? 0,
          });
        } else {
          await callRpc('edit_sale_with_shipping', {
            p_sale_id: editingSale.id,
            p_new_product_id: editingSale.productId,
            p_new_quantity: editingSale.quantity,
            p_new_unit_price: editingSale.unitPrice,
            p_new_adjustment: editingSale.adjustment ?? 0,
            p_new_status: 'Pagado',
            p_new_payment_method: formData.paymentMethod ?? null,
            p_new_client: editingSale.client ?? null,
            p_new_date: editingSale.date,
            p_shipping_amount: editingSale.shippingAmount ?? 0,
          });
        }
      } else if (editingSale) {
        const editPlan = getSalesPageEditPlan(editingSale);
        if ('reason' in editPlan) {
          alert(editPlan.reason);
          return;
        }
        if (holdingsEnabled) {
          const mutationDenial = saleMutationDenialReason(editingSale);
          if (mutationDenial) {
            alert(mutationDenial);
            return;
          }
          const effectiveCustomerId = resolveAttributedSaleCustomerId(
            editingSale.id,
            selectedCustomer?.id ?? null,
            customerTransactions,
          );
          const items = buildAttributedSaleCommandItems(isMultiItemPosEdit
            ? editingLineItems.map(item => ({
              productId: item.productId,
              productName: item.productName,
              quantity: Number(item.quantity) || 0,
              unitPrice: Number(item.price) || 0,
              lineDiscount: Number(item.discount) || 0,
            }))
            : [{
              productId: formData.productId ?? '',
              productName: formData.productName ?? editingSale.productName,
              quantity: Number(formData.quantity) || 0,
              unitPrice: Number(formData.unitPrice) || 0,
              lineDiscount: editingSale.items?.[0]?.discount ?? 0,
              ...(preferredOwnerId ? { preferredOwnerId } : {}),
            }]);
          const payload = {
            p_sale_id: editingSale.id,
            p_items: items,
            p_adjustment_total: formData.adjustment ?? 0,
            p_status: formData.status,
            p_payment_method: formData.paymentMethod ?? null,
            p_customer_id: effectiveCustomerId,
            p_client: formData.client ?? null,
            p_date: formData.date,
            p_shipping_amount: shippingEnabled ? Number(formData.shippingAmount) || 0 : 0,
          };
          editIntentRef.current = resolveIdempotencyIntent('sale:edit', payload, editIntentRef.current);
          await callRpc('edit_attributed_sale_with_shipping', {
            ...payload,
            p_idempotency_key: editIntentRef.current.key,
          });
          editIntentRef.current = null;
        } else if (editPlan.rpc === 'edit_pos_sale') {
          await callRpc('edit_pos_sale_with_shipping', {
            p_sale_id: editingSale.id,
            p_new_items: isMultiItemPosEdit
              ? editingLineItems.map(item => ({
                productId: item.productId,
                quantity: Number(item.quantity) || 0,
                unitPrice: Number(item.price) || 0,
                lineDiscount: Number(item.discount) || 0,
              }))
              : [{
                productId: formData.productId,
                quantity: formData.quantity,
                unitPrice: formData.unitPrice,
                lineDiscount: editingSale.items?.[0]?.discount ?? 0,
              }],
            p_new_adjustment: formData.adjustment ?? 0,
            p_new_status: formData.status,
            p_new_payment_method: formData.paymentMethod ?? null,
            p_new_customer_id: null,
            p_new_date: formData.date,
            p_shipping_amount: shippingEnabled ? Number(formData.shippingAmount) || 0 : 0,
          });
        } else {
          await callRpc('edit_sale_with_shipping', {
            p_sale_id:            editingSale.id,
            p_new_product_id:     formData.productId,
            p_new_quantity:       formData.quantity,
            p_new_unit_price:     formData.unitPrice,
            p_new_adjustment:     formData.adjustment ?? 0,
            p_new_status:         formData.status,
            p_new_payment_method: formData.paymentMethod ?? null,
            p_new_client:         formData.client ?? null,
            p_new_date:           formData.date,
            p_shipping_amount:    shippingEnabled ? Number(formData.shippingAmount) || 0 : 0,
          });
        }
      } else {
        const status     = (isCreditSale && selectedCustomer) ? 'Pendiente' : formData.status;
        const clientName = (isCreditSale && selectedCustomer)
          ? selectedCustomer.name
          : (formData.client ?? null);

        if (holdingsEnabled) {
          const payload = {
            p_items: buildAttributedSaleCommandItems([{
              productId: formData.productId ?? '',
              productName: formData.productName ?? '',
              quantity: Number(formData.quantity) || 0,
              unitPrice: Number(formData.unitPrice) || 0,
              lineDiscount: 0,
              ...(preferredOwnerId ? { preferredOwnerId } : {}),
            }]),
            p_payment_method: status === 'Pagado' ? formData.paymentMethod ?? null : null,
            p_status: status,
            p_customer_id: (isCreditSale && selectedCustomer) ? selectedCustomer.id : null,
            p_adjustment_total: formData.adjustment ?? 0,
            p_date: formData.date,
            p_source: 'manual',
            p_shipping_amount: shippingEnabled ? Number(formData.shippingAmount) || 0 : 0,
          };
          registerIntentRef.current = resolveIdempotencyIntent(
            'sale:register', payload, registerIntentRef.current,
          );
          await callRpc('register_attributed_sale_with_shipping', {
            ...payload,
            p_idempotency_key: registerIntentRef.current.key,
          });
          registerIntentRef.current = null;
        } else {
          await callRpc('register_sale_with_shipping', {
            p_date:           formData.date,
            p_product_id:     formData.productId,
            p_quantity:       formData.quantity,
            p_unit_price:     formData.unitPrice,
            p_adjustment:     formData.adjustment ?? 0,
            p_status:         status,
            p_payment_method: formData.paymentMethod ?? null,
            p_client:         clientName,
            p_customer_id:    (isCreditSale && selectedCustomer) ? selectedCustomer.id : null,
            p_shipping_amount: shippingEnabled ? Number(formData.shippingAmount) || 0 : 0,
          });
        }
      }

      setIsModalOpen(false);
      setEditingSale(null);
      setPaymentCorrectionOnly(false);
      setFormData({
        date: todayString(),
        productId: '',
        quantity: 1,
        unitPrice: 0,
        adjustment: 0,
        shippingAmount: 0,
        status: 'Pagado',
        paymentMethod: 'Efectivo',
        client: ''
      });
      setIsCreditSale(false);
      setCreditSearch('');
      setSelectedCustomer(null);
      setShowNewCustInline(false);
      setNewCustName('');
      setNewCustPhone('');
      setPreferredOwnerId('');
      setShippingEnabled(false);
      fetchData();
    } catch (error) {
      console.error('Error al guardar venta:', error);
      alert(error instanceof Error ? error.message : 'Error al guardar la venta.');
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const settlements = useMemo(() => buildSaleSettlements(sales, customerTransactions), [sales, customerTransactions]);
  const formPaidAmount = editingSale
    ? settlements.get(editingSale.id)?.paid ?? (editingSale.status === 'Pagado' ? editingSale.total : 0)
    : 0;
  const formIsPending = formData.status !== 'Pagado' || (!editingSale && isCreditSale && Boolean(selectedCustomer));
  const formPendingBalance = formIsPending ? Math.max(0, roundPrice(formTotalWithShipping - formPaidAmount)) : 0;
  const protectedSaleIds = useMemo(() => new Set(customerTransactions
    .filter(transaction => transaction.accountPayment && transaction.relatedSaleId)
    .map(transaction => transaction.relatedSaleId)), [customerTransactions]);
  const statusBusyRef = useRef(false);

  const handleToggleStatus = async (projection: OwnerSaleProjection) => {
    if (statusBusyRef.current || !canWrite) return;
    const sale = sales.find((candidate) => candidate.id === projection.id);
    if (!sale) return;
    if (isQuoteSale(sale)) {
      alert('Las ventas creadas desde presupuestos se gestionan desde el presupuesto original.');
      return;
    }
    const mutationDenial = saleMutationDenialReason(sale, projection);
    if (mutationDenial) {
      alert(mutationDenial);
      return;
    }
    const settlement = settlements.get(sale.id);
    if (settlement?.customerId) {
      if (sale.status === 'Pagado' || settlement.pending <= 0) {
        alert('Esta venta ya está cobrada. No se puede volver a cobrar ni anular el pago cambiando su estado.');
        return;
      }
      navigate(`/clientes?customer=${encodeURIComponent(settlement.customerId)}&sale=${encodeURIComponent(sale.id)}`);
      return;
    }
    const newStatus = isPendingSaleStatus(sale.status) ? 'Pagado' : 'Pendiente';
    statusBusyRef.current = true;
    setStatusSavingSaleId(sale.id);
    try {
      if (holdingsEnabled) {
        const payload = { p_sale_id: sale.id, p_new_status: newStatus };
        statusIntentRef.current = resolveIdempotencyIntent(
          'sale:status', payload, statusIntentRef.current,
        );
        await callRpc('toggle_attributed_sale_status', {
          ...payload,
          p_idempotency_key: statusIntentRef.current.key,
        });
        statusIntentRef.current = null;
      } else {
        await callRpc('toggle_sale_status', { p_sale_id: sale.id, p_new_status: newStatus });
      }
      fetchData();
    } catch (error) {
      console.error('Error al cambiar estado:', error);
      alert(error instanceof Error ? error.message : 'Error al cambiar el estado.');
    } finally {
      statusBusyRef.current = false;
      setStatusSavingSaleId(null);
    }
  };

  const handleDelete = async (projection: OwnerSaleProjection, confirmed = false) => {
    const sale = sales.find((candidate) => candidate.id === projection.id);
    if (!sale) return;
    if (protectedSaleIds.has(sale.id)) {
      alert('Esta venta tiene cobros de cuenta corriente registrados. No se puede eliminar su historial de pagos.');
      return;
    }
    const mutationDenial = saleMutationDenialReason(sale, projection);
    if (mutationDenial) {
      alert(mutationDenial);
      return;
    }
    if (!confirmed && !confirm(holdingsEnabled
      ? '¿Estás seguro de devolver esta venta y restaurar el stock atribuido?'
      : '¿Estás seguro de eliminar esta venta?')) return;
    try {
      if (holdingsEnabled) {
        const payload = { saleId: sale.id };
        refundIntentRef.current = resolveIdempotencyIntent(
          'sale:refund', payload, refundIntentRef.current,
        );
        await callRpc('refund_attributed_sale', {
          p_sale_id: sale.id,
          p_idempotency_key: refundIntentRef.current.key,
        });
        refundIntentRef.current = null;
      } else {
        await callRpc('delete_sale', { p_sale_id: sale.id });
      }
      fetchData();
    } catch (error) {
      console.error('Error al eliminar venta:', error);
      alert(error instanceof Error ? error.message : 'Error al eliminar la venta.');
    }
  };

  const openSaleForEdit = (projection: OwnerSaleProjection) => {
    const sale = sales.find((candidate) => candidate.id === projection.id);
    if (!sale) return;
    if (protectedSaleIds.has(sale.id)) {
      alert('Esta venta tiene cobros de cuenta corriente registrados. No se puede reescribir su historial de pagos.');
      return;
    }
    const editPlan = getSalesPageEditPlan(sale);
    if ('reason' in editPlan) {
      alert(editPlan.reason);
      return;
    }
    const mutationDenial = saleMutationDenialReason(sale, projection);
    if (mutationDenial) {
      alert(mutationDenial);
      return;
    }
    setEditingSale(sale);
    setPaymentCorrectionOnly(false);
    setFormData({ ...sale, items: sale.items ?? [] });
    setEditingLineIndex(null);
    setShippingEnabled(Number(sale.shippingAmount) > 0);
    const ownerIds = [...new Set(
      saleAllocations
        .filter((allocation) => allocation.saleIdSnapshot === projection.id && !allocation.reversedAt)
        .map((allocation) => allocation.inventoryOwnerIdSnapshot),
    )];
    const currentCustomerId = resolveAttributedSaleCustomerId(
      sale.id,
      null,
      customerTransactions,
    );
    setSelectedCustomer(customers.find((customer) => customer.id === currentCustomerId) ?? null);
    setPreferredOwnerId(ownerIds.length === 1 ? ownerIds[0] : '');
    setIsModalOpen(true);
  };

  const openPaymentCorrection = (projection: OwnerSaleProjection) => {
    const sale = sales.find(candidate => candidate.id === projection.id);
    if (!sale || !canWrite || sale.status !== 'Pagado' || isQuoteSale(sale) || protectedSaleIds.has(sale.id)) return;
    const mutationDenial = saleMutationDenialReason(sale, projection);
    if (mutationDenial) {
      alert(mutationDenial);
      return;
    }
    setEditingSale(sale);
    setPaymentCorrectionOnly(true);
    setFormData({ ...sale, items: sale.items ?? [], status: 'Pagado' });
    setShippingEnabled(Number(sale.shippingAmount) > 0);
    setSelectedCustomer(null);
    setIsModalOpen(true);
  };

  // Attribution changes only with the underlying dataset/scope, not each
  // search keystroke. Keep complete economics separate from display pages.
  const projectedSales = useMemo(() => projectAttributedSales(
    sales, saleAllocations, saleItems, allowedInventoryOwnerIds, ownerFilter, holdingsEnabled,
  ), [sales, saleAllocations, saleItems, allowedInventoryOwnerIds, ownerFilter, holdingsEnabled]);
  const salesById = useMemo(() => new Map(sales.map(sale => [sale.id, sale])), [sales]);
  const activeAllocationsBySaleId = useMemo(() => {
    const grouped = new Map<string, SaleItemAllocation[]>();
    for (const allocation of saleAllocations) {
      if (allocation.reversedAt) continue;
      const list = grouped.get(allocation.saleIdSnapshot) ?? [];
      list.push(allocation);
      grouped.set(allocation.saleIdSnapshot, list);
    }
    return grouped;
  }, [saleAllocations]);

  const periodRange = useMemo(
    () => getSalesDateRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo],
  );
  const periodLabel = useMemo(
    () => formatSalesRange(periodRange, periodPreset),
    [periodRange, periodPreset],
  );
  const filterLabel = [
    statusFilter === 'all' ? null : 'Estado: ' + statusFilter,
    deferredSearch.trim() ? 'Búsqueda: ' + deferredSearch.trim() : null,
    holdingsEnabled && ownerFilter !== 'all'
      ? 'Titular: ' + (inventoryOwners.find(owner => owner.id === ownerFilter)?.name ?? 'seleccionado')
      : null,
    zeroOnly ? 'Ventas en $0' : null,
  ].filter(Boolean).join(' · ') || 'Sin filtros adicionales';

  const { filteredSales, totalCollected, totalPending, totalSold, ticketCount, unitCount, grossProfit, costAvailableCount } = useMemo(() => {
    const selected: Array<OwnerSaleProjection & { isSearchSubset?: boolean }> = [];
    const searchValue = requestedSaleId ? '' : deferredSearch.trim().toLocaleLowerCase('es-AR');

    for (const sale of projectedSales) {
      if (requestedSaleId) {
        if (sale.id !== requestedSaleId) continue;
      } else {
        if (periodRange.from && sale.date < periodRange.from) continue;
        if (periodRange.to && sale.date > periodRange.to) continue;
        const matchesStatus = statusFilter === 'all'
          || sale.status === statusFilter
          || (statusFilter === 'Pendiente' && sale.status === 'No Pagado');
        if (!matchesStatus) continue;
      }

      const original = sales.find(candidate => candidate.id === sale.id);
      const matchesClient = Boolean(searchValue && sale.client?.toLocaleLowerCase('es-AR').includes(searchValue));
      const matchingItems = searchValue
        ? sale.items.filter(item => item.productName.toLocaleLowerCase('es-AR').includes(searchValue))
        : sale.items;
      if (!requestedSaleId && searchValue && !matchesClient && matchingItems.length === 0
        && !sale.productName.toLocaleLowerCase('es-AR').includes(searchValue)) continue;

      let row: OwnerSaleProjection & { isSearchSubset?: boolean } = sale;
      const isSearchSubset = Boolean(searchValue && !matchesClient && matchingItems.length > 0 && matchingItems.length < sale.items.length);
      if (isSearchSubset) {
        const subtotal = sale.items.reduce((sum, item) => sum + item.quantity * item.unitPrice - item.discount, 0);
        const matchedRevenue = matchingItems.reduce((sum, item) => {
          if (holdingsEnabled) return sum + item.revenue;
          const lineSubtotal = item.quantity * item.unitPrice - item.discount;
          const adjustmentShare = subtotal !== 0 ? (original?.adjustment ?? 0) * lineSubtotal / subtotal : 0;
          return sum + lineSubtotal + adjustmentShare;
        }, 0);
        row = {
          ...sale,
          productName: [...new Set(matchingItems.map(item => item.productName))].join(' · '),
          quantity: matchingItems.reduce((sum, item) => sum + item.quantity, 0),
          unitPrice: matchingItems.length === 1 ? matchingItems[0].unitPrice : null,
          adjustment: matchingItems.reduce((sum, item) => sum + item.adjustment, 0),
          total: roundPrice(matchedRevenue),
          costTotal: roundPrice(matchingItems.reduce((sum, item) => sum + item.cost, 0)),
          items: matchingItems,
          isSearchSubset: true,
        };
      }
      if (!requestedSaleId && zeroOnly && Math.abs(roundPrice(row.total)) > 0.009) continue;
      selected.push(row);
    }

    let totalSold = 0;
    let totalCollected = 0;
    let totalPending = 0;
    let unitCount = 0;
    let grossProfit = 0;
    let costAvailableCount = 0;
    for (const sale of selected) {
      const original = sales.find(candidate => candidate.id === sale.id);
      totalSold += roundPrice(sale.total);
      unitCount += sale.quantity;
      const settlement = settlements.get(sale.id);
      const fullTotal = settlement?.total ?? original?.total ?? sale.total;
      const fraction = fullTotal > 0 ? sale.total / fullTotal : 0;
      if (settlement) {
        totalCollected += settlement.paid * fraction;
        totalPending += settlement.pending * fraction;
      }

      const itemIds = new Set(sale.items.map(item => item.saleItemId));
      const allocations = (activeAllocationsBySaleId.get(sale.id) ?? [])
        .filter(allocation => itemIds.has(allocation.saleItemId));
      const hasHistoricalCost = holdingsEnabled && sale.items.length > 0
        && sale.items.every(item => {
          const itemAllocations = allocations.filter(allocation => allocation.saleItemId === item.saleItemId);
          return itemAllocations.length > 0 && itemAllocations.every(allocation => allocation.allocationSource !== 'legacy_estimated');
        });
      if (hasHistoricalCost) {
        costAvailableCount += 1;
        const productRevenue = sale.isSearchSubset
          ? sale.total
          : Math.max(0, sale.total - Number(original?.shippingAmount ?? 0));
        grossProfit += productRevenue - sale.costTotal;
      }
    }
    return {
      filteredSales: selected,
      totalCollected: roundPrice(totalCollected),
      totalPending: roundPrice(totalPending),
      totalSold: roundPrice(totalSold),
      ticketCount: selected.length,
      unitCount,
      grossProfit: roundPrice(grossProfit),
      costAvailableCount,
    };
  }, [
    deferredSearch, projectedSales, statusFilter, settlements, sales, periodRange,
    zeroOnly, holdingsEnabled, activeAllocationsBySaleId, requestedSaleId,
  ]);
  const pagination = usePagination(filteredSales);
  const costMissingCount = Math.max(0, filteredSales.length - costAvailableCount);
  const selectedDateBounds = filteredSales.reduce((bounds, sale) => ({
    from: sale.date < bounds.from ? sale.date : bounds.from,
    to: sale.date > bounds.to ? sale.date : bounds.to,
  }), { from: filteredSales[0]?.date ?? '', to: filteredSales[0]?.date ?? '' });
  const reportPeriodLabel = periodPreset === 'all' && filteredSales.length
    ? formatDate(selectedDateBounds.from) + ' al ' + formatDate(selectedDateBounds.to)
    : periodLabel;
  const debtByCustomer = useMemo(() => {
    const groups = new Map<string, { id?: string; name: string; amount: number; oldestDate: string; sales: OwnerSaleProjection[] }>();
    for (const sale of filteredSales) {
      const settlement = settlements.get(sale.id);
      const original = sales.find(candidate => candidate.id === sale.id);
      const fullTotal = settlement?.total ?? original?.total ?? sale.total;
      const pending = Math.max(0, (settlement?.pending ?? (isPendingSaleStatus(sale.status) ? sale.total : 0)) * (fullTotal > 0 ? sale.total / fullTotal : 1));
      if (pending <= 0) continue;
      const customerId = settlement?.customerId;
      const key = customerId ?? 'name:' + (sale.client || 'Sin cliente');
      const group = groups.get(key) ?? {
        id: customerId,
        name: sale.client || 'Cliente sin identificar',
        amount: 0,
        oldestDate: sale.date,
        sales: [],
      };
      group.amount += pending;
      if (sale.date < group.oldestDate) group.oldestDate = sale.date;
      group.sales.push(sale);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.amount - a.amount);
  }, [filteredSales, settlements, sales]);
  const collections = useMemo(() => {
    const payments = customerTransactions
      .filter(transaction => transaction.type === 'payment' && transaction.relatedSaleId)
      .map(transaction => {
        const sale = salesById.get(transaction.relatedSaleId!);
        return sale ? {
          id: transaction.id,
          saleId: sale.id,
          date: transaction.date.slice(0, 10),
          amount: Math.abs(transaction.amount),
          client: sale.client || customers.find(customer => customer.id === transaction.customerId)?.name || 'Cliente',
          method: transaction.paymentMethod || 'Sin método',
        } : null;
      })
      .filter((payment): payment is NonNullable<typeof payment> => Boolean(payment));
    const paidSalesWithoutLedger = sales.filter(sale =>
      sale.status === 'Pagado'
      && !customerTransactions.some(transaction => transaction.relatedSaleId === sale.id && transaction.type === 'payment'),
    ).map(sale => ({
      id: 'sale:' + sale.id,
      saleId: sale.id,
      date: sale.date.slice(0, 10),
      amount: sale.total,
      client: sale.client || 'Venta directa',
      method: sale.paymentMethod || 'Sin método',
    }));
    return [...payments, ...paidSalesWithoutLedger].filter(payment =>
      payment.date >= collectionsFrom && payment.date <= collectionsTo);
  }, [customerTransactions, sales, customers, collectionsFrom, collectionsTo]);
  const collectionsTotal = roundPrice(collections.reduce((sum, payment) => sum + payment.amount, 0));

  if (loadError) return <div role="alert" className="p-6"><p>{loadError}</p><button onClick={fetchData}>Reintentar</button></div>;

  return (
    <>
    {isMobile && <MobileSalesList
      sales={filteredSales}
      products={products}
      inventoryOwners={inventoryOwners}
      holdingsEnabled={holdingsEnabled}
      canCreate={canWrite && !inventoryAccessError && renderCreationActions}
      canWrite={canWrite}
      canDelete={canDelete}
      saving={saving}
      statusSavingSaleId={statusSavingSaleId}
      canMutateSale={sale => shouldRenderSalesMutationActions(holdingsEnabled, ticketHasFullOperableScope(sale))}
      onCreate={openNewSale}
      onOpenPos={() => navigate('/pos')}
      onEdit={openSaleForEdit}
      onCorrectPayment={openPaymentCorrection}
      canCorrectPayment={sale => sale.status === 'Pagado' && sale.source !== 'quote' && !protectedSaleIds.has(sale.id)}
      onDelete={handleDelete}
      onToggleStatus={handleToggleStatus}
      search={search}
      onSearchChange={setSearch}
      statusFilter={statusFilter}
      onStatusFilterChange={setStatusFilter}
      ownerFilter={ownerFilter}
      onOwnerFilterChange={setOwnerFilter}
      periodPreset={periodPreset}
      onPeriodPresetChange={setPeriodPreset}
      customFrom={customFrom}
      customTo={customTo}
      onCustomFromChange={setCustomFrom}
      onCustomToChange={setCustomTo}
      periodLabel={periodLabel}
      zeroOnly={zeroOnly}
      onZeroOnlyChange={setZeroOnly}
      totalSold={totalSold}
      totalCollected={totalCollected}
      totalPending={totalPending}
      ticketCount={ticketCount}
      unitCount={unitCount}
      grossProfit={grossProfit}
      costAvailableCount={costAvailableCount}
      costMissingCount={costMissingCount}
      onOpenInsight={setActiveInsight}
      onOpenCollections={() => setShowCollectionsModal(true)}
      formatAmount={amount => formatCurrency(roundPrice(amount))}
      onExportExcel={handleExportExcel}
      onExportPdf={handleExportPDF}
      exporting={exporting}
      loading={loading}
      error={loadError}
    />}
    <div className={cn('operational-page w-full min-w-0 max-w-full space-y-6', isMobile && 'hidden')}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="page-heading text-3xl font-bold text-slate-900 dark:text-white">Ventas</h2>
          <p className="text-slate-500 dark:text-slate-400">Registra y gestiona tus ventas</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 sm:flex-none" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(v => !v)}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <Download size={20} />
              Exportar
              <ChevronDown size={16} />
            </button>
            {showExportMenu && (
              <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-56 max-w-[calc(100vw_-_2rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm z-20 overflow-hidden">
                <button
                  onClick={handleExportExcel}
                  disabled={exporting}
                  className="w-full text-left px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-3"
                >
                  <FileSpreadsheet size={16} className="text-emerald-600" />
                  Exportar Excel (.xlsx)
                </button>
                <button onClick={() => handleExportPDF('summary')} disabled={exporting}
                  className="w-full text-left px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-3 border-t border-slate-100 dark:border-slate-800">
                  <FileDown size={16} className="text-rose-600" /> Resumen PDF (1 página)
                </button>
                <button onClick={() => handleExportPDF('detail')} disabled={exporting}
                  className="w-full text-left px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-3 border-t border-slate-100 dark:border-slate-800">
                  <FileDown size={16} className="text-rose-600" /> Detalle de ventas</button>
              </div>
            )}
          </div>
          {renderCreationActions && (<>
          <button
            onClick={() => navigate('/pos')}
            disabled={!canWrite || Boolean(inventoryAccessError)}
            title={!canWrite ? 'Sin permiso' : 'Abrir Modo POS'}
            className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-sm shadow-rose-500/20 transition-all disabled:opacity-50"
          >
            <ScanLine size={20} />
            Modo POS
          </button>
          <button
            onClick={() => {
              setEditingSale(null);
              setFormData({
                date: todayString(),
                productId: '',
                quantity: 1,
                unitPrice: 0,
                adjustment: 0,
                status: 'Pagado',
                paymentMethod: 'Efectivo',
                client: ''
              });
              setIsCreditSale(false);
              setCreditSearch('');
              setSelectedCustomer(null);
              setShowNewCustInline(false);
              setNewCustName('');
              setNewCustPhone('');
              setPreferredOwnerId('');
              setIsModalOpen(true);
            }}
            className="bg-[#365fad] hover:bg-[#284b91] text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-sm shadow-slate-900/10 transition-all disabled:opacity-50"
            disabled={!canWrite || Boolean(inventoryAccessError)}
            title={!canWrite ? 'Sin permiso' : undefined}
          >
            <Plus size={20} />
            Nueva Venta
          </button>
          </>)}
        </div>
      </div>

      {requestedSaleId && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-200">
        <span>Mostrando el ticket {getSaleTicketLabel(requestedSaleId)} asociado al pedido.</span>
        <button type="button" onClick={() => { const next = new URLSearchParams(searchParams); next.delete('sale'); setSearchParams(next, { replace: true }); }} className="min-h-9 rounded-lg border border-current/20 px-3 font-bold hover:bg-white/40 dark:hover:bg-white/5">Ver todas las ventas</button>
      </div>}

      {inventoryAccessError && (
        <div role="alert" className="px-4 py-3 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-sm font-semibold">
          {inventoryAccessError}
        </div>
      )}

      <section aria-label="Período de ventas" className="operational-card flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Período
            <select aria-label="Período de ventas" value={periodPreset} onChange={event => setPeriodPreset(event.target.value as SalesPeriodPreset)}
              className="mt-1 block min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <option value="today">Hoy</option><option value="week">Esta semana</option><option value="month">Este mes</option><option value="custom">Personalizado</option><option value="all">Todo el historial</option>
            </select>
          </label>
          {periodPreset === 'custom' && <>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Desde<input type="date" aria-label="Desde" value={customFrom} onChange={event => setCustomFrom(event.target.value)} className="mt-1 block min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Hasta<input type="date" aria-label="Hasta" value={customTo} onChange={event => setCustomTo(event.target.value)} className="mt-1 block min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
          </>}
          <p className="pb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">{periodLabel}</p>
        </div>
        <button type="button" onClick={() => setShowCollectionsModal(true)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-[#365fad] hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
          Cobros por fecha de pago
        </button>
      </section>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button type="button" onClick={() => setActiveInsight('sold')} className="operational-card w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-[#365fad] dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3"><div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Vendido en el período</p>
            <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{formatCurrency(totalSold)}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{ticketCount} tickets · {unitCount} unidades</p>
            <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-400">Cobrado de estas ventas: {formatCurrency(totalCollected)}</p>
          </div><div className="rounded-xl bg-indigo-50 p-2 text-[#365fad] dark:bg-indigo-900/20 dark:text-indigo-400"><ShoppingCart size={20} /></div></div>
        </button>
        <button type="button" onClick={() => setActiveInsight('profit')} className="operational-card w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-500 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3"><div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Ganancia bruta</p>
            <p className="mt-1 text-xl font-bold text-emerald-600 dark:text-emerald-400">{costAvailableCount ? formatCurrency(grossProfit) : 'Sin datos'}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Costo histórico en {costAvailableCount} de {ticketCount} ventas{costMissingCount ? ' · ' + costMissingCount + ' incompletas' : ''}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">El envío se excluye del cálculo.</p>
          </div><div className="rounded-xl bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400"><CheckCircle2 size={20} /></div></div>
        </button>
        <button type="button" onClick={() => setActiveInsight('pending')} className="operational-card w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-amber-500 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3"><div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Por cobrar</p>
            <p className="mt-1 text-xl font-bold text-amber-600 dark:text-amber-400">{formatCurrency(totalPending)}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Tocar para ver cliente, antigüedad y registrar cobro.</p>
          </div><div className="rounded-xl bg-amber-50 p-2 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"><Clock size={20} /></div></div>
        </button>
      </div>

      {/* Filters */}
      <div className={cn('grid grid-cols-1 gap-4', holdingsEnabled ? 'md:grid-cols-4' : 'md:grid-cols-3')}>
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder="Buscar por producto o cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none transition-all dark:text-white"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none transition-all dark:text-white appearance-none"
          >
            <option value="all">Todos los estados</option>
            <option value="Pagado">Pagado</option>
            <option value="Pendiente">Pendiente</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
        </div>
        {holdingsEnabled && (
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <select
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none transition-all dark:text-white appearance-none"
            >
              <option value="all">Todos mis titulares</option>
              {inventoryOwners.map((owner) => (
                <option key={owner.id} value={owner.id}>{owner.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
          </div>
        )}
        <button type="button" aria-pressed={zeroOnly} onClick={() => setZeroOnly(value => !value)}
          className={cn('min-h-11 rounded-xl border px-3 text-sm font-semibold transition-colors', zeroOnly
            ? 'border-[#365fad] bg-indigo-50 text-[#284b91] dark:bg-indigo-900/20 dark:text-indigo-300'
            : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400')}>
          Ventas en $0
        </button>
      </div>

      {/* Table */}
      <div className="operational-card min-w-0 max-w-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[980px] table-fixed text-left">
            <thead className="table-head bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
              <tr>
                <th className="sticky left-0 z-20 w-[112px] min-w-[112px] bg-slate-50 px-3 py-4 dark:bg-slate-800">Fecha</th>
                <th className="w-[190px] px-3 py-4">Producto</th>
                <th className="w-[60px] px-3 py-4">Cant.</th>
                <th className="w-[100px] px-3 py-4">Precio U.</th>
                <th className="w-[100px] px-3 py-4">Ajuste</th>
                <th className="w-[110px] px-3 py-4">Total</th>
                <th className="w-[105px] px-3 py-4">Método</th>
                <th className="w-[95px] px-3 py-4">Estado</th>
                <th className="w-[108px] px-3 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {pagination.rows.map((s) => (
                <React.Fragment key={s.id}>
                  <tr id={`sale-ticket-${s.id}`} data-sale-ticket={s.id} className="table-row group text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="sticky left-0 z-10 w-[112px] min-w-[112px] bg-white px-3 py-4 dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50 dark:text-slate-300 whitespace-nowrap"><span className="block">{formatDate(s.date)}</span><span className="mt-1 block font-mono text-[9px] text-slate-400">Ticket {getSaleTicketLabel(s.id)}</span></td>
                  <td className="w-[190px] max-w-[190px] px-3 py-4">
                    <button
                      type="button"
                      onClick={() => setExpandedSaleId(expandedSaleId === s.id ? null : s.id)}
                      className="min-w-0 w-full text-left"
                    >
                      <p className="break-words font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        {s.productName}
                        {(s.items.length > 1 || s.ownerNames.length > 0) && (
                          <span className="inline-flex items-center justify-center w-4 h-4 text-slate-400">
                            {expandedSaleId === s.id ? '▾' : '▸'}
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {s.source === 'pos' && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                            POS
                          </span>
                        )}
                        {s.source === 'quote' && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-indigo-100 text-[#284b91] dark:bg-indigo-900/30 dark:text-indigo-400">
                            Presupuesto
                          </span>
                        )}
                        {holdingsEnabled && s.isPartial && (
                          <span className={cn(
                            'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded',
                            s.isPartial
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                          )}>
                            {s.isPartial ? 'Vista parcial' : null}
                          </span>
                        )}
                        {s.isSearchSubset && <span className="text-[9px] font-semibold uppercase text-indigo-500">Productos coincidentes</span>}
                        {s.client && <p className="text-[10px] text-slate-400 uppercase font-bold">{s.client}</p>}
                      </div>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 dark:text-slate-300">{s.quantity}</td>
                  <td className="whitespace-nowrap px-3 py-4 dark:text-slate-300">
                    {s.unitPrice === null ? '-' : formatCurrency(roundPrice(s.unitPrice))}
                  </td>
                  <td className={cn(
                    "px-3 py-4 font-medium",
                    s.adjustment > 0 ? "text-rose-500" : s.adjustment < 0 ? "text-emerald-500" : "text-slate-400"
                  )}>
                    {s.adjustment !== 0 ? formatCurrency(roundPrice(s.adjustment)) : '-'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 font-bold dark:text-white">{formatCurrency(roundPrice(s.total))}</td>
                  <td className="px-3 py-4">
                    {s.status === 'Pagado' ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400">{s.paymentMethod}</span>
                    ) : '-'}
                  </td>
                  <td className="px-3 py-4">
                    {shouldRenderSalesMutationActions(
                      holdingsEnabled,
                      ticketHasFullOperableScope(s),
                    ) ? (
                    <button
                      onClick={() => handleToggleStatus(s)}
                      disabled={
                        !canWrite
                        || statusSavingSaleId === s.id
                        || Boolean(projectedSaleMutationDenialReason(s))
                      }
                      title={!canWrite
                        ? 'Sin permiso'
                        : projectedSaleMutationDenialReason(s)
                          ?? (settlements.get(s.id)?.customerId ? 'Gestionar cobro en la ficha del cliente' : s.status === 'Pagado' ? 'Click para marcar como Pendiente' : 'Click para marcar como Pagado')}
                      className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase cursor-pointer transition-opacity hover:opacity-70 disabled:opacity-50 disabled:cursor-not-allowed",
                        s.status === 'Pagado' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      )}
                    >
                      {s.status === 'Pagado' ? 'Pagado' : `Pendiente: ${formatCurrency((settlements.get(s.id)?.pending ?? s.total) * (settlements.get(s.id)?.total ? s.total / settlements.get(s.id)!.total : 1))}`}
                    </button>
                    ) : (
                      <span
                        title="Estado de solo lectura"
                        className={cn(
                          'px-2 py-1 rounded-full text-[10px] font-bold uppercase',
                          s.status === 'Pagado'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                        )}
                      >
                        {s.status}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {shouldRenderSalesMutationActions(
                      holdingsEnabled,
                      ticketHasFullOperableScope(s),
                    ) ? (
                    <div className="flex items-center justify-end gap-2">
                      {s.status === 'Pagado' && !protectedSaleIds.has(s.id) && s.source !== 'quote' && (
                        <button onClick={() => openPaymentCorrection(s)} disabled={!canWrite || Boolean(projectedSaleMutationDenialReason(s))}
                          title="Corregir medio de pago" className="p-2 text-slate-400 transition-colors hover:text-[#365fad] disabled:opacity-40"><CreditCard size={18} /></button>
                      )}
                      <button
                        onClick={() => openSaleForEdit(s)}
                        disabled={!canWrite || Boolean(projectedSaleMutationDenialReason(s))}
                        title={!canWrite
                          ? 'Sin permiso'
                          : projectedSaleMutationDenialReason(s) ?? 'Editar'}
                        className={cn(
                          "p-2 transition-colors",
                          !canWrite
                            ? "text-slate-300 dark:text-slate-700 cursor-not-allowed"
                            : "text-slate-400 hover:text-[#365fad] dark:hover:text-indigo-400"
                        )}
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        disabled={!canDelete || Boolean(projectedSaleMutationDenialReason(s))}
                        title={!canDelete ? 'Sin permiso' : projectedSaleMutationDenialReason(s) ?? undefined}
                        className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    ) : (
                      <span className="text-slate-400" title="Acciones no disponibles en modo solo lectura">-</span>
                    )}
                  </td>
                </tr>
                {expandedSaleId === s.id && (s.items.length > 1 || s.ownerNames.length > 0) && (
                  <tr className="bg-slate-50/50 dark:bg-slate-800/30">
                    <td colSpan={9} className="px-6 pb-4">
                      <div className="ml-4 pl-4 border-l-2 border-[#b7c7e8] dark:border-indigo-700">
                        <p className="text-[10px] uppercase font-bold text-slate-400 mb-2">
                          {s.isPartial ? 'Productos visibles' : 'Productos vendidos'}
                        </p>
                        <ul className="space-y-1.5">
                          {s.items.map((item) => (
                            <li key={item.saleItemId} className="flex items-center justify-between text-xs">
                              <span className="text-slate-700 dark:text-slate-300">
                                <span className="font-bold text-[#365fad] dark:text-indigo-400">{item.quantity}×</span> {item.productName}
                              </span>
                              <span className="text-slate-500 dark:text-slate-400 font-mono">
                                {formatCurrency(roundPrice(item.revenue))}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {s.ownerNames.length > 0 && (
                          <p className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#365fad] dark:text-indigo-300">
                            Titulares visibles: {s.ownerNames.join(', ')}
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
              {filteredSales.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    {projectedSales.length === 0
                      ? 'Todavía no registraste ventas. Creá la primera desde Nueva Venta.'
                      : 'No hay ventas que coincidan con los filtros aplicados.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pagination {...pagination} />
        </div>
      </div>

    </div>
      <Modal
        isOpen={activeInsight !== null}
        onClose={() => setActiveInsight(null)}
        title={activeInsight === 'sold' ? 'Ventas del período' : activeInsight === 'profit' ? 'Ganancia bruta' : 'Por cobrar'}
      >
        {activeInsight === 'sold' && <div className="max-h-[65vh] space-y-3 overflow-y-auto">
          <p className="text-sm text-slate-500 dark:text-slate-400">{periodLabel} · {ticketCount} tickets · {unitCount} unidades · Cobrado {formatCurrency(totalCollected)}</p>
          {filteredSales.map(sale => <div key={sale.id} className="flex justify-between gap-3 border-b border-slate-100 py-3 text-sm dark:border-slate-800">
            <div><p className="font-semibold text-slate-900 dark:text-white">Ticket {getSaleTicketLabel(sale.id)} · {sale.productName}</p><p className="mt-1 text-xs text-slate-500">{formatDate(sale.date)} · {sale.quantity} unidades · {sale.client || 'Sin cliente'}</p></div>
            <strong className="shrink-0 text-slate-900 dark:text-white">{formatCurrency(roundPrice(sale.total))}</strong>
          </div>)}
          {filteredSales.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No hay ventas para esta selección.</p>}
        </div>}
        {activeInsight === 'profit' && <div className="space-y-4">
          <div className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-900/20">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Ganancia bruta con costo histórico</p>
            <p className="mt-1 text-2xl font-black text-emerald-800 dark:text-emerald-200">{costAvailableCount ? formatCurrency(grossProfit) : 'Sin datos'}</p>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">Se calcula con los productos, descuentos y ajustes visibles; el envío queda separado. El costo histórico está disponible en {costAvailableCount} de {ticketCount} tickets{costMissingCount ? ', y faltan datos completos en ' + costMissingCount + '.' : '.'}</p>
        </div>}
        {activeInsight === 'pending' && <div className="max-h-[65vh] space-y-3 overflow-y-auto">
          <p className="text-sm text-slate-500 dark:text-slate-400">{periodLabel} · Saldo pendiente total {formatCurrency(totalPending)}</p>
          {debtByCustomer.map(group => {
            const days = Math.max(0, Math.floor((Date.now() - new Date(group.oldestDate + 'T12:00:00').getTime()) / 86400000));
            const firstSale = group.sales[0];
            return <section key={group.id ?? group.name} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-bold text-slate-900 dark:text-white">{group.name}</h3><p className="mt-1 text-xs text-slate-500">Deuda más antigua: hace {days} días · {formatDate(group.oldestDate)}</p></div>
                <strong className="shrink-0 text-amber-600">{formatCurrency(roundPrice(group.amount))}</strong>
              </div>
              <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                {group.sales.map(sale => <li key={sale.id} className="flex justify-between gap-3"><span>Ticket {getSaleTicketLabel(sale.id)} · {formatDate(sale.date)}</span><span>{formatCurrency(roundPrice((settlements.get(sale.id)?.pending ?? sale.total) * (settlements.get(sale.id)?.total ? sale.total / settlements.get(sale.id)!.total : 1)))}</span></li>)}
              </ul>
              {group.id ? <button type="button" onClick={() => { setActiveInsight(null); navigate('/clientes?customer=' + encodeURIComponent(group.id!) + '&sale=' + encodeURIComponent(firstSale.id)); }}
                className="mt-4 min-h-11 w-full rounded-xl bg-[#365fad] px-4 text-sm font-semibold text-white">Registrar cobro</button>
                : <p className="mt-3 text-xs text-slate-500">Vinculá este nombre con un cliente para registrar el cobro desde su cuenta.</p>}
            </section>;
          })}
          {debtByCustomer.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No hay saldos pendientes en esta selección.</p>}
        </div>}
      </Modal>

      <Modal isOpen={showCollectionsModal} onClose={() => setShowCollectionsModal(false)} title="Cobros por fecha de pago">
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">La fecha del cobro se consulta por separado de la fecha original de la venta.</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-500">Desde<input type="date" value={collectionsFrom} onChange={event => setCollectionsFrom(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
            <label className="text-xs font-semibold text-slate-500">Hasta<input type="date" value={collectionsTo} onChange={event => setCollectionsTo(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-900/20"><p className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-300">Ingresado en esas fechas</p><p className="mt-1 text-2xl font-black text-emerald-800 dark:text-emerald-200">{formatCurrency(collectionsTotal)}</p></div>
          <div className="max-h-[45vh] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {collections.map(payment => <div key={payment.id} className="flex justify-between gap-3 py-3 text-sm">
              <div><p className="font-semibold text-slate-900 dark:text-white">{payment.client}</p><p className="mt-1 text-xs text-slate-500">Ticket {getSaleTicketLabel(payment.saleId)} · {formatDate(payment.date)} · {payment.method}</p></div>
              <strong className="shrink-0 text-emerald-700 dark:text-emerald-300">{formatCurrency(payment.amount)}</strong>
            </div>)}
            {collections.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No hay cobros registrados en ese rango.</p>}
          </div>
        </div>
      </Modal>

      {/* Add/Edit Modal */}
      <Modal 
        isOpen={isModalOpen} 
        onClose={() => { setIsModalOpen(false); setPaymentCorrectionOnly(false); }} 
        title={paymentCorrectionOnly ? 'Corregir medio de pago' : editingSale ? 'Editar Venta' : 'Nueva Venta'}
      >
        <form onSubmit={handleSave} className="operational-page space-y-6">
          {paymentCorrectionOnly && <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-200">
            Se actualizará únicamente el medio de pago del ticket {getSaleTicketLabel(editingSale?.id ?? '')}. La fecha, los productos, el importe y el stock se conservan.
          </div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2"><h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Datos del ticket</h3></div>
            {editingSale && <div className="md:col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800"><span className="text-slate-500">Número de venta </span><strong className="font-mono text-slate-900 dark:text-white">{getSaleTicketLabel(editingSale.id)}</strong></div>}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Fecha</label>
              <input 
                type="date"
                required
                max={todayString()}
                value={formData.date}
                onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Cliente (Opcional)</label>
              <input
                type="text"
                value={formData.client}
                onChange={(e) => setFormData(prev => ({ ...prev, client: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
                placeholder="Nombre del cliente"
              />
            </div>
            <div className="md:col-span-2"><h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Productos</h3></div>
            {isMultiItemPosEdit ? (
              <section className="md:col-span-2 space-y-3 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">Productos del ticket</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">La corrección conserva el mismo número de venta y actualiza el stock con el historial.</p>
                </div>
                {editingLineItems.map((item, index) => {
                  const selectedProduct = products.find(product => product.id === item.productId);
                  const lineSubtotal = Math.max(0, item.quantity * (item.price - (item.discount ?? 0)));
                  return (
                    <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {selectedProduct && <ProductThumbnail product={selectedProduct} sizeClassName="size-11" />}
                        <div className="min-w-0 flex-1">
                          {editingLineIndex === index ? (
                            <ProductSearchSelect
                              products={products}
                              inventoryOwners={holdingsEnabled ? [] : inventoryOwners}
                              value={item.productId}
                              onChange={productId => {
                                const product = products.find(candidate => candidate.id === productId);
                                setFormData(previous => {
                                  const currentItems = previous.items ?? [];
                                  const duplicateIndex = currentItems.findIndex((line, lineIndex) => lineIndex !== index && line.productId === productId);
                                  if (duplicateIndex >= 0) {
                                    const selectedLine = currentItems[index];
                                    return {
                                      ...previous,
                                      items: currentItems
                                        .map((line, lineIndex) => lineIndex === duplicateIndex
                                          ? { ...line, quantity: line.quantity + (selectedLine?.quantity ?? 0) }
                                          : line)
                                        .filter((_, lineIndex) => lineIndex !== index),
                                    };
                                  }
                                  return {
                                    ...previous,
                                    items: currentItems.map((line, lineIndex) => lineIndex === index
                                      ? { ...line, productId, productName: product?.name ?? line.productName, price: product?.salePrice ?? line.price }
                                      : line),
                                  };
                                });
                                setEditingLineIndex(null);
                              }}
                              placeholder="Buscar producto..."
                              required
                            />
                          ) : (
                            <button type="button" onClick={() => setEditingLineIndex(index)} className="block max-w-full truncate text-left font-semibold text-slate-900 dark:text-white">
                              {item.productName || 'Elegir producto'} <span className="ml-1 text-xs font-medium text-[#365fad]">Cambiar producto</span>
                            </button>
                          )}
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            <label className="text-[11px] text-slate-500">Cantidad
                              <NumberField min="1" integer aria-label={"Cantidad de " + item.productName} value={item.quantity}
                                onChange={event => setFormData(previous => ({ ...previous, items: (previous.items ?? []).map((line, lineIndex) => lineIndex === index ? { ...line, quantity: Number(event.target.value) } : line) }))}
                                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                            </label>
                            <label className="text-[11px] text-slate-500">Precio unitario
                              <MoneyInput aria-label={"Precio de " + item.productName} value={item.price}
                                onChange={event => setFormData(previous => ({ ...previous, items: (previous.items ?? []).map((line, lineIndex) => lineIndex === index ? { ...line, price: Number(event.target.value) } : line) }))}
                                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                            </label>
                            <div className="text-[11px] text-slate-500">Subtotal
                              <p className="mt-2 text-sm font-bold text-slate-900 dark:text-white">{formatCurrency(roundPrice(lineSubtotal))}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      <button type="button" aria-label={"Quitar " + item.productName} disabled={editingLineItems.length <= 1}
                        onClick={() => setFormData(previous => ({ ...previous, items: (previous.items ?? []).filter((_, lineIndex) => lineIndex !== index) }))}
                        className="h-10 w-10 self-start rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-30 dark:hover:bg-rose-900/20"><X size={17} /></button>
                    </div>
                  );
                })}
                <button type="button" onClick={() => {
                  setFormData(previous => ({ ...previous, items: [...(previous.items ?? []), { productId: '', productName: '', quantity: 1, price: 0, discount: 0 }] }));
                  setEditingLineIndex(editingLineItems.length);
                }} className="flex min-h-10 items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 text-sm font-semibold text-[#365fad] dark:border-slate-600">
                  <Plus size={16} /> Agregar producto
                </button>
              </section>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Producto</label>
                  <ProductSearchSelect products={products} inventoryOwners={holdingsEnabled ? [] : inventoryOwners} value={formData.productId || ''} onChange={handleProductChange} placeholder="Buscar por nombre o categoría..." required />
                </div>
                {holdingsEnabled && formData.productId && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Titular preferido</label>
                    <select value={preferredOwnerId} onChange={event => setPreferredOwnerId(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                      <option value="">Automático{defaultInventoryOwnerId ? ' (predeterminado y prioridad)' : ''}</option>
                      {selectedProductOwnerOptions.map(owner => {
                        const holding = holdings.find(candidate => candidate.productId === formData.productId && candidate.inventoryOwnerId === owner.id && candidate.active);
                        return <option key={owner.id} value={owner.id}>{owner.name} · Stock {holding?.stock ?? 0}</option>;
                      })}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Cantidad</label>
                  <NumberField required min="1" integer aria-label="Cantidad" value={formData.quantity}
                    onChange={event => setFormData(previous => ({ ...previous, quantity: Number(event.target.value) }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Precio unitario</label>
                  <MoneyInput required min="0" aria-label="Precio unitario" value={formData.unitPrice}
                    onChange={event => setFormData(previous => ({ ...previous, unitPrice: Number(event.target.value) }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>
              </>
            )}
            <div className="md:col-span-2"><h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Importes y pago</h3></div>

            <AdjustmentInput
              label="Ajuste (Descuento/Recargo)"
              value={Number(formData.adjustment) || 0}
              onChange={(adjustment) => setFormData(prev => ({ ...prev, adjustment }))}
            />

            <React.Suspense fallback={<div className="min-h-12" aria-label="Cargando opción de envío" />}>
              <LazySaleShippingControl
                ownerUid={user?.uid}
                enabled={shippingEnabled}
                amount={Number(formData.shippingAmount) || 0}
                onEnabledChange={enabled => {
                  setShippingEnabled(enabled);
                }}
                onAmountChange={shippingAmount => setFormData(previous => ({ ...previous, shippingAmount }))}
              />
            </React.Suspense>



            {holdingsEnabled && editingSale && selectedCustomer && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Cliente de cuenta corriente
                </label>
                <select
                  value={selectedCustomer.id}
                  onChange={(event) => {
                    const customer = customers.find((candidate) => candidate.id === event.target.value);
                    if (!customer) return;
                    setSelectedCustomer(customer);
                    setFormData((previous) => ({ ...previous, client: customer.name }));
                  }}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
                >
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Se conserva automáticamente si no lo cambiás.
                </p>
              </div>
            )}

            {/* Cuenta corriente toggle — solo en nueva venta */}
            {!editingSale && (
              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreditSale(v => !v);
                    setCreditSearch('');
                    setSelectedCustomer(null);
                    setShowNewCustInline(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 font-semibold text-sm transition-all',
                    isCreditSale
                      ? 'bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-900/20 dark:border-amber-500 dark:text-amber-400'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500'
                  )}
                >
                  <UserCheck size={18} />
                  {isCreditSale ? 'Venta a cuenta corriente — activada' : 'Cargar a cuenta corriente'}
                </button>

                {isCreditSale && (
                  <div className="mt-2 space-y-2">
                    {selectedCustomer ? (
                      <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
                        <div>
                          <p className="font-bold text-amber-800 dark:text-amber-300 text-sm">{selectedCustomer.name}</p>
                          {selectedCustomer.phone && <p className="text-xs text-amber-600 dark:text-amber-400">{selectedCustomer.phone}</p>}
                        </div>
                        <button type="button" onClick={() => setSelectedCustomer(null)} className="text-amber-400 hover:text-amber-700">
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            placeholder="Buscar cliente en cuenta corriente..."
                            value={creditSearch}
                            onChange={e => { setCreditSearch(e.target.value); setShowNewCustInline(false); }}
                            className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-400 dark:text-white"
                          />
                        </div>
                        {filteredCreditCustomers.length > 0 && (
                          <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                            {filteredCreditCustomers.map(c => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => { setSelectedCustomer(c); setCreditSearch(''); }}
                                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800 last:border-0 transition-colors text-sm"
                              >
                                <p className="font-medium text-slate-900 dark:text-white">{c.name}</p>
                                {c.phone && <p className="text-xs text-slate-400">{c.phone}</p>}
                              </button>
                            ))}
                          </div>
                        )}
                        {creditSearch.length > 1 && filteredCreditCustomers.length === 0 && !showNewCustInline && (
                          <button
                            type="button"
                            onClick={() => { setShowNewCustInline(true); setNewCustName(creditSearch); }}
                            className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 font-medium hover:underline"
                          >
                            <UserPlus size={15} />
                            Crear cliente "{creditSearch}"
                          </button>
                        )}
                        {showNewCustInline && (
                          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                            <input
                              type="text"
                              placeholder="Nombre *"
                              value={newCustName}
                              onChange={e => setNewCustName(e.target.value)}
                              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none dark:text-white"
                            />
                            <input
                              type="tel"
                              placeholder="Teléfono"
                              value={newCustPhone}
                              onChange={e => setNewCustPhone(e.target.value)}
                              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none dark:text-white"
                            />
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setShowNewCustInline(false)} className="flex-1 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500">Cancelar</button>
                              <button
                                type="button"
                                disabled={savingNewCust}
                                onClick={async () => {
                                  if (!user || !newCustName.trim() || savingNewCust) return;
                                  setSavingNewCust(true);
                                  try {
                                    const now = new Date().toISOString();
                                    const nc = await db.create<Customer>('customers', {
                                      id: crypto.randomUUID(),
                                      ownerUid: user.uid,
                                      name: newCustName.trim(),
                                      nameLower: newCustName.trim().toLowerCase(),
                                      phone: newCustPhone.trim() || undefined,
                                      currentBalance: 0,
                                      createdAt: now,
                                      updatedAt: now,
                                    });
                                    setCustomers(prev => [...prev, nc]);
                                    setSelectedCustomer(nc);
                                    setShowNewCustInline(false);
                                    setCreditSearch('');
                                    setNewCustName('');
                                    setNewCustPhone('');
                                  } finally {
                                    setSavingNewCust(false);
                                  }
                                }}
                                className="flex-1 py-1.5 text-sm bg-amber-600 text-white rounded-lg font-semibold disabled:opacity-60"
                              >
                                {savingNewCust ? 'Guardando...' : 'Crear'}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}



            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Estado de Pago</label>
              <div className="flex gap-4">
                <button 
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, status: 'Pagado' }))}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold border-2 transition-all flex items-center justify-center gap-2",
                    formData.status === 'Pagado' 
                      ? "bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-500 dark:text-emerald-400" 
                      : "bg-white border-slate-200 text-slate-400 dark:bg-slate-900 dark:border-slate-800"
                  )}
                >
                  <CheckCircle2 size={20} />
                  PAGADO
                </button>
                <button 
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, status: 'Pendiente' }))}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold border-2 transition-all flex items-center justify-center gap-2",
                    formData.status === 'Pendiente'
                      ? "bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-900/20 dark:border-amber-500 dark:text-amber-400"
                      : "bg-white border-slate-200 text-slate-400 dark:bg-slate-900 dark:border-slate-800"
                  )}
                >
                  <Clock size={20} />
                  PENDIENTE
                </button>
              </div>
            </div>

            {formData.status === 'Pagado' && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Método de Pago</label>
                <div className="flex gap-2 overflow-x-auto">
                  {(['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Otro'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, paymentMethod: method as any }))}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-sm font-semibold border transition-all",
                        formData.paymentMethod === method
                          ? "bg-[#365fad] border-[#365fad] text-white"
                          : "bg-white border-slate-200 text-slate-600 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400"
                      )}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 z-10 -mx-4 mt-4 space-y-3 border-t border-[var(--line)] bg-white/95 p-4 backdrop-blur dark:bg-slate-900/95">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-[var(--ink-subtle)]"><span>Subtotal productos</span><p className="mt-1 font-semibold text-[var(--ink)]">{formatCurrency(isMultiItemPosEdit ? multiItemSubtotal : saleTotals.subtotal)}</p></div>
              <div className="text-[var(--ink-subtle)]"><span>Envío</span><p className="mt-1 font-semibold text-[var(--ink)]">{formatCurrency(shippingEnabled ? Number(formData.shippingAmount) || 0 : 0)}</p></div>
              {multiItemDiscount > 0 && <div className="col-span-2 text-xs text-[var(--ink-muted)]">Descuentos por producto: {formatCurrency(multiItemDiscount)}</div>}
              <div className="border-t border-[var(--line)] pt-2"><span className="text-xs font-bold uppercase text-[var(--ink-muted)]">Total de la venta</span><p className="mt-1 text-xl font-black text-[var(--brand)]">{formatCurrency(formTotalWithShipping)}</p></div>
              <div className="border-t border-[var(--line)] pt-2"><span className="text-xs font-bold uppercase text-[var(--ink-muted)]">Saldo pendiente</span><p className="mt-1 text-xl font-black text-[var(--ink)]">{formatCurrency(formPendingBalance)}</p></div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-400">Cancelar</button>
              <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-[#365fad] px-4 py-2.5 font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-60">
                {saving ? 'Guardando...' : paymentCorrectionOnly ? 'Guardar corrección' : editingSale ? 'Guardar cambios' : 'Registrar venta'}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
