import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Menu,

} from 'lucide-react';
import type { InventoryOwner, PermissionMatrix, Sale, UserProfile } from '../../types';
import type { DashboardSummary } from '../../lib/dashboardSummary';
import type { RestockRecommendation } from '../../lib/stockIntelligence';
import { getMobileQuickActions } from '../../lib/mobileQuickActions';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useBusinessPlan } from '../../hooks/useBusinessPlan';
import { useMobileAppChrome, useMobileAppMenu } from '../../hooks/useMobileAppChrome';
import BottomSheet from './BottomSheet';

export type DashboardDataSource = 'sales' | 'cashFlow' | 'orders';
export interface DashboardSourceState {
  loading: boolean;
  error: boolean;
}
export type DashboardSourceStates = Record<DashboardDataSource, DashboardSourceState>;

interface MobileHomeProps {
  user: UserProfile | null;
  isOwner: boolean;
  isPlatformAdmin: boolean;
  permissions: PermissionMatrix;
  now: Date;
  summary: DashboardSummary;
  sourceStates: DashboardSourceStates;
  onRetrySource: (source: DashboardDataSource) => void;
  visibleOwners: InventoryOwner[];
  valuationOwner: InventoryOwner | null;
  onSelectOwner: (ownerId: string) => void;
  stockByCategoryData: Array<{ name: string; value: number }>;
  restockRecommendations: RestockRecommendation[];
  exporting: boolean;
  onExport: () => void;
  notices: ReactNode;
}

interface AttentionItem {
  label: string;
  detail: string;
  value?: string;
  href?: string;
  source?: DashboardDataSource;
  severity: 'danger' | 'warning' | 'neutral';
}

function localDateLabel(now: Date): string {
  const value = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now).replace(',', '');
  return value.charAt(0).toLocaleUpperCase('es-AR') + value.slice(1);
}

function greeting(now: Date): string {
  if (now.getHours() < 12) return 'Buen día';
  if (now.getHours() < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function greetingName(user: UserProfile | null): string {
  const displayName = user?.displayName.trim().split(/\s+/)[0];
  return displayName || user?.businessName.trim() || 'tu negocio';
}

function initials(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase('es-AR')).join('') || 'RS';
}

function formatSaleTime(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function saleProductsLabel(sale: Sale): string {
  const items = sale.items ?? [];
  if (items.length === 0) return sale.productName + (sale.quantity > 1 ? ' × ' + sale.quantity : '');
  const first = items[0];
  const firstLabel = first.productName + (first.quantity > 1 ? ' × ' + first.quantity : '');
  return items.length > 1 ? firstLabel + ' · +' + (items.length - 1) + ' artículos' : firstLabel;
}

function shortMonthLabel(label: string): string {
  const month = label.split(' ')[0].replace('.', '');
  return month.charAt(0).toLocaleUpperCase('es-AR') + month.slice(1);
}

function SourceValue({
  state,
  retry,
  children,
}: {
  state: DashboardSourceState;
  retry: () => void;
  children: ReactNode;
}) {
  if (state.loading) {
    return <span role="status" aria-label="Cargando dato" className="mt-1 block h-7 w-28 animate-pulse rounded-lg bg-[var(--surface-muted)]" />;
  }
  if (state.error) {
    return (
      <button
        type="button"
        onClick={retry}
        className="inline-flex min-h-11 items-center rounded-lg px-1 text-left text-sm font-semibold text-[var(--danger-ink)] underline underline-offset-2"
      >
        No se pudo cargar · Reintentar
      </button>
    );
  }
  return <>{children}</>;
}

function AttentionRow({
  item,
  onRetry,
}: {
  item: AttentionItem;
  onRetry: (source: DashboardDataSource) => void;
}) {
  const dotColor = item.severity === 'danger'
    ? 'bg-[var(--danger-ink)]'
    : item.severity === 'warning'
      ? 'bg-[var(--warning-ink)]'
      : 'bg-[var(--ink-muted)]';
  const content = (
    <>
      <span aria-hidden="true" className={'size-2 shrink-0 rounded-full ' + dotColor} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-[var(--ink)]">{item.label}</span>
        <span className="block truncate text-sm text-[var(--ink-muted)]">{item.detail}</span>
      </span>
      {item.value && <span className="shrink-0 text-sm text-[var(--ink-muted)]">{item.value}</span>}
      {item.source ? (
        <span className="shrink-0 text-sm font-semibold text-[var(--danger-ink)]">Reintentar</span>
      ) : (
        <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-[var(--ink-muted)]" />
      )}
    </>
  );
  const className = 'flex min-h-14 w-full items-center gap-3 border-t border-[var(--line)] py-2 text-left text-sm';

  if (item.source) {
    return <button type="button" onClick={() => onRetry(item.source!)} className={className}>{content}</button>;
  }
  return <Link to={item.href ?? '/'} className={className}>{content}</Link>;
}

function MonthSalesChart({ data }: { data: DashboardSummary['monthlySalesData'] }) {
  const max = Math.max(1, ...data.map((item) => item.total));
  const description = data.map((item) => shortMonthLabel(item.label) + ': ' + formatCurrency(item.total)).join(', ');
  return (
    <div className="pt-3">
      <div role="img" aria-label={'Ventas de los últimos seis meses: ' + description} className="grid h-28 grid-cols-6 items-end gap-2 border-b border-[var(--line)]">
        {data.map((item, index) => (
          <span
            key={item.label}
            aria-hidden="true"
            className="flex h-full items-end"
          >
            <span
              className="w-full rounded-t bg-[var(--surface-muted)] last:bg-[var(--brand)]"
              style={{ height: Math.max(8, Math.round((item.total / max) * 100)) + '%', background: index === data.length - 1 ? 'var(--brand)' : 'var(--surface-muted)' }}
            />
          </span>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1 grid grid-cols-6 gap-2 text-center text-xs text-[var(--ink-muted)]">
        {data.map((item, index) => (
          <span key={item.label} className={index === data.length - 1 ? 'font-semibold text-[var(--ink)]' : ''}>
            {shortMonthLabel(item.label)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function MobileHome({
  user,
  isOwner,
  isPlatformAdmin,
  permissions,
  now,
  summary,
  sourceStates,
  onRetrySource,
  visibleOwners,
  valuationOwner,
  onSelectOwner,
  stockByCategoryData,
  restockRecommendations,
  exporting,
  onExport,
  notices,
}: MobileHomeProps) {
  const { plan } = useBusinessPlan();
  const quickActions = getMobileQuickActions(permissions, isOwner, plan?.limits.modules ?? null);
  const openMobileMenu = useMobileAppMenu();
  useMobileAppChrome({ hideHeader: true, hideBottomNav: false });
  const [businessSheetOpen, setBusinessSheetOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [ownerSheetOpen, setOwnerSheetOpen] = useState(false);
  const businessName = user?.businessName.trim() || 'Mi negocio';
  const monthTitle = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(now);
  const showSales = permissions.ventas.read;
  const showCash = permissions.caja.read;
  const showStock = permissions.stock.read;
  const estimatedRestockCost = restockRecommendations.reduce((total, item) => total + item.estimatedCost, 0);
  const attentionItems: AttentionItem[] = [];

  if (showStock && summary.alerts.outOfStockCount > 0) {
    attentionItems.push({
      label: 'Sin stock',
      detail: summary.alerts.outOfStockCount + ' productos',
      href: '/stock?estado=no-disponible',
      severity: 'danger',
    });
  }
  if (showStock && !sourceStates.sales.loading && !sourceStates.sales.error && restockRecommendations.length > 0) {
    attentionItems.push({
      label: 'Para reponer',
      detail: 'Inversión estimada ' + formatCurrency(estimatedRestockCost),
      value: String(restockRecommendations.length),
      href: '/stock?estado=reponer',
      severity: 'warning',
    });
  }
  if (showSales && sourceStates.sales.error) {
    attentionItems.push({
      label: 'Ventas',
      detail: 'No se pudo cargar',
      source: 'sales',
      severity: 'danger',
    });
  } else if (showSales && summary.today.pendingReceivables > 0) {
    attentionItems.push({
      label: 'Cobros pendientes',
      detail: formatCurrency(summary.today.pendingReceivables),
      href: '/ventas',
      severity: 'neutral',
    });
  }
  if (showCash && sourceStates.cashFlow.error) {
    attentionItems.push({
      label: 'Caja',
      detail: 'No se pudo cargar',
      source: 'cashFlow',
      severity: 'danger',
    });
  }
  if (permissions.pedidos.read && sourceStates.orders.error) {
    attentionItems.push({
      label: 'Pedidos',
      detail: 'No se pudo cargar',
      source: 'orders',
      severity: 'danger',
    });
  }

  return (
    <div className="space-y-9 pb-6 lg:hidden">
      <header className="flex min-h-11 items-center gap-1">
        <button
          type="button"
          aria-label={'Negocio activo: ' + businessName}
          onClick={() => setBusinessSheetOpen(true)}
          className="flex h-9 max-w-[70%] min-w-0 items-center gap-2 rounded-full bg-[var(--surface-muted)] py-1 pl-1.5 pr-3 text-sm font-medium text-[var(--ink)]"
        >
          <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-[var(--action-ink)]">{initials(businessName)}</span>
          <span className="truncate">{businessName}</span>
          <ChevronDown aria-hidden="true" size={14} className="shrink-0" />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Avisos"
          onClick={() => setNotificationsOpen(true)}
          className="relative grid size-11 shrink-0 place-items-center rounded-full text-[var(--ink)]"
        >
          <Bell aria-hidden="true" size={21} strokeWidth={1.8} />
          {attentionItems.length > 0 && <span aria-hidden="true" className="absolute mr-[-18px] mt-[-18px] size-2 rounded-full bg-[var(--warning-ink)]" />}
        </button>
        <button
          type="button"
          aria-label="Abrir menú completo"
          onClick={openMobileMenu}
          className="grid size-11 shrink-0 place-items-center rounded-full text-[var(--ink)]"
        >
          <Menu aria-hidden="true" size={22} strokeWidth={1.8} />
        </button>
      </header>

      {notices}

      <div>
        <p className="text-sm text-[var(--ink-muted)]">{localDateLabel(now)}</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-[var(--ink)]">{greeting(now)}, {greetingName(user)}</h1>
      </div>

      {(showSales || showCash) && (
        <section aria-labelledby="mobile-today-heading">
          <h2 id="mobile-today-heading" className="text-sm font-medium text-[var(--ink-muted)]">
            {showSales ? 'Vendiste hoy' : 'Disponible'}
          </h2>
          {showSales && (
            <SourceValue state={sourceStates.sales} retry={() => onRetrySource('sales')}>
              <p className="mt-1 text-[46px] font-medium leading-none tracking-tight text-[var(--ink)]">{formatCurrency(summary.today.salesTotal)}</p>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                {summary.today.salesCount} {summary.today.salesCount === 1 ? 'venta' : 'ventas'}
                {formatSaleTime(summary.today.latestSale?.createdAt) && ' · la última a las ' + formatSaleTime(summary.today.latestSale?.createdAt)}
              </p>
            </SourceValue>
          )}
          <dl className={"mt-5 grid gap-3 " + (showSales && showCash ? "grid-cols-3" : "grid-cols-2")}>
            {showCash && (
              <>
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--ink-muted)]">Efectivo</dt>
                  <dd className="mt-1 text-base font-medium text-[var(--ink)]">
                    <SourceValue state={sourceStates.cashFlow} retry={() => onRetrySource('cashFlow')}>{formatCurrency(summary.today.cashAvailable)}</SourceValue>
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--ink-muted)]">Transferencias</dt>
                  <dd className="mt-1 text-base font-medium text-[var(--ink)]">
                    <SourceValue state={sourceStates.cashFlow} retry={() => onRetrySource('cashFlow')}>{formatCurrency(summary.month.transferAvailable)}</SourceValue>
                  </dd>
                </div>
              </>
            )}
            {showSales && (
              <div className="min-w-0">
                <dt className="text-xs text-[var(--ink-muted)]">Te deben</dt>
                <dd className="mt-1 text-base font-medium text-[var(--ink)]">
                  <SourceValue state={sourceStates.sales} retry={() => onRetrySource('sales')}>{formatCurrency(summary.today.pendingReceivables)}</SourceValue>
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {quickActions.length > 0 && (
        <nav aria-label="Accesos rápidos" className="grid grid-cols-2 gap-2">
          {quickActions.map(({ label, path, icon: Icon }, index) => (
            <Link
              key={path}
              to={path}
              className="flex min-h-14 items-center gap-3 overflow-hidden rounded-lg bg-[var(--surface-muted)] text-sm font-semibold text-[var(--ink)]"
            >
              <span className={'grid size-14 shrink-0 place-items-center ' + (index === 0 ? 'bg-[var(--brand)] text-[var(--action-ink)]' : 'bg-[var(--surface-muted)] text-[var(--ink)]')}>
                <Icon aria-hidden="true" size={22} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 pr-2">{label}</span>
            </Link>
          ))}
        </nav>
      )}

      {attentionItems.length > 0 && (
        <section aria-labelledby="mobile-attention-heading">
          <h2 id="mobile-attention-heading" className="mb-1 text-xl font-semibold tracking-tight text-[var(--ink)]">Para atender</h2>
          {attentionItems.map((item, index) => (
            <AttentionRow key={item.label + index} item={item} onRetry={onRetrySource} />
          ))}
        </section>
      )}

      {(showSales || showCash) && (
        <section aria-labelledby="mobile-month-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="mobile-month-heading" className="text-xl font-semibold tracking-tight text-[var(--ink)]">Este mes</h2>
            {showSales && <Link to="/reportes" className="text-sm font-medium text-[var(--brand)]">Reportes</Link>}
          </div>
          <dl className={'mt-3 grid gap-3 ' + (showSales && showCash ? 'grid-cols-2' : 'grid-cols-1')}>
            {showSales && (
              <div className="min-w-0">
                <dt className="text-sm text-[var(--ink-muted)]">Ventas de {monthTitle}</dt>
                <dd className="mt-1 text-[22px] font-medium tracking-tight text-[var(--ink)]">
                  <SourceValue state={sourceStates.sales} retry={() => onRetrySource('sales')}>{formatCurrency(summary.month.salesTotal)}</SourceValue>
                </dd>
              </div>
            )}
            {showCash && (
              <div className="min-w-0">
                <dt className="text-sm text-[var(--ink-muted)]">Balance neto</dt>
                <dd className="mt-1 text-[22px] font-medium tracking-tight text-[var(--ink)]">
                  <SourceValue state={sourceStates.cashFlow} retry={() => onRetrySource('cashFlow')}>{formatCurrency(summary.month.netBalance)}</SourceValue>
                </dd>
              </div>
            )}
          </dl>
          {showSales && (
            sourceStates.sales.loading || sourceStates.sales.error
              ? <div className="mt-4"><SourceValue state={sourceStates.sales} retry={() => onRetrySource('sales')}> </SourceValue></div>
              : <MonthSalesChart data={summary.monthlySalesData} />
          )}
        </section>
      )}

      {showStock && (
        <section aria-labelledby="mobile-inventory-heading">
          <div className="flex min-h-9 items-center justify-between gap-2">
            <h2 id="mobile-inventory-heading" className="text-xl font-semibold tracking-tight text-[var(--ink)]">Tu mercadería</h2>
            {visibleOwners.length > 1 && (
              <button
                type="button"
                onClick={() => setOwnerSheetOpen(true)}
                className="flex h-8 max-w-[55%] items-center gap-1 truncate rounded-full border border-[var(--line)] px-3 text-[13px] font-medium text-[var(--ink)]"
              >
                <span className="truncate">Titular: {valuationOwner?.name ?? 'Elegir'}</span>
                <ChevronDown aria-hidden="true" size={14} className="shrink-0" />
              </button>
            )}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4">
            <div>
              <dt className="text-[13px] text-[var(--ink-muted)]">Valor a precio de venta</dt>
              <dd className="mt-1 text-[19px] font-medium text-[var(--ink)]">{formatCurrency(summary.month.stockValue)}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-[var(--ink-muted)]">Lo que invertiste</dt>
              <dd className="mt-1 text-[19px] font-medium text-[var(--ink)]">{formatCurrency(summary.month.totalInvested)}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-[var(--ink-muted)]">Ganancia si vendés todo</dt>
              <dd className="mt-1 text-[19px] font-medium text-[var(--success-ink)]">{formatCurrency(summary.month.potentialProfit)}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-[var(--ink-muted)]">Productos sin stock</dt>
              <dd className="mt-1 text-[19px] font-semibold text-[var(--danger-ink)]">{summary.alerts.outOfStockCount}</dd>
            </div>
          </dl>

          {stockByCategoryData.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 text-[13px] font-medium text-[var(--ink-muted)]">Valor por categoría</h3>
              <ul role="list" className="flex list-none flex-col gap-2.5 p-0">
                {stockByCategoryData.slice(0, 4).map((category, index) => {
                  const maxValue = Math.max(1, ...stockByCategoryData.slice(0, 4).map((item) => item.value));
                  const barWidth = Math.max(4, Math.round((category.value / maxValue) * 100));
                  return (
                    <li key={category.name} className="grid grid-cols-[84px_minmax(0,1fr)_84px] items-center gap-2.5 text-[13px]">
                      <span className="truncate">{category.name}</span>
                      <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                        <span className="block h-full rounded-full" style={{ width: barWidth + '%', background: index === 0 ? 'var(--brand)' : 'var(--line-strong)' }} />
                      </span>
                      <span className="text-right text-[var(--ink-muted)]">{formatCurrency(category.value)}</span>
                    </li>
                  );
                })}
              </ul>
              <Link to="/stock" className="mt-3 inline-block text-sm font-medium text-[var(--brand)]">Ver las {stockByCategoryData.length} categorías</Link>
            </>
          )}
        </section>
      )}

      {showSales && (
        <section aria-labelledby="mobile-recent-sales-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="mobile-recent-sales-heading" className="text-xl font-semibold tracking-tight text-[var(--ink)]">Últimas ventas</h2>
            <Link to="/ventas" className="text-sm font-medium text-[var(--brand)]">Ver todas</Link>
          </div>
          {sourceStates.sales.loading || sourceStates.sales.error ? (
            <div className="mt-2"><SourceValue state={sourceStates.sales} retry={() => onRetrySource('sales')}> </SourceValue></div>
          ) : (
            <ul role="list" className="mt-1 list-none p-0">
              {summary.recentSales.length > 0 ? summary.recentSales.slice(0, 5).map((sale) => {
                const saleStatus = sale.status === 'Pagado' ? null : ' · pendiente de cobro';
                const timeText = formatSaleTime(sale.createdAt) ?? formatDate(sale.date);
                return (
                  <li key={sale.id} className="flex min-h-[60px] items-center gap-3 border-t border-[var(--line)] py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[var(--ink)]">{sale.client || 'Consumidor final'}</span>
                      <span className={'block truncate text-[13px] ' + (saleStatus ? 'text-[var(--warning-ink)]' : 'text-[var(--ink-muted)]')}>
                        {saleProductsLabel(sale)} · {timeText}{saleStatus}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-[var(--ink)]">{formatCurrency(sale.total)}</span>
                  </li>
                );
              }) : <li className="border-t border-[var(--line)] py-4 text-center text-sm text-[var(--ink-muted)]">No hay ventas registradas</li>}
            </ul>
          )}
        </section>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--ink)] disabled:opacity-50"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>
          {exporting ? 'Preparando reporte…' : 'Exportar reporte en PDF'}
        </button>
        {isPlatformAdmin && (
          <Link to="/plataforma" className="flex min-h-11 items-center justify-center text-sm font-medium text-[var(--ink-muted)]">
            Panel de plataforma
          </Link>
        )}
      </div>

      {businessSheetOpen && (
        <BottomSheet title="Negocio activo" onClose={() => setBusinessSheetOpen(false)}>
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-[var(--ink)]">{businessName}</p>
            <p className="text-[var(--ink-muted)]">Este negocio pertenece a la sesión actual.</p>
          </div>
        </BottomSheet>
      )}

      {notificationsOpen && (
        <BottomSheet title="Avisos" onClose={() => setNotificationsOpen(false)}>
          {attentionItems.length > 0 ? (
            <div className="divide-y divide-[var(--line)]">
              {attentionItems.map((item, index) => (
                <AttentionRow key={item.label + index} item={item} onRetry={onRetrySource} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--ink-muted)]">No hay avisos para revisar.</p>
          )}
        </BottomSheet>
      )}

      {ownerSheetOpen && (
        <BottomSheet title="Titular para valoración de stock" onClose={() => setOwnerSheetOpen(false)}>
          <div className="space-y-2">
            <p className="text-sm text-[var(--ink-muted)]">Elegí qué existencias querés ver en los indicadores.</p>
            {visibleOwners.map((owner) => {
              const isSelected = owner.id === valuationOwner?.id;
              return (
                <button
                  key={owner.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => { onSelectOwner(owner.id); setOwnerSheetOpen(false); }}
                  className={'flex min-h-12 w-full items-center justify-between rounded-xl border px-3 text-left text-sm font-semibold ' + (isSelected ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--line)] text-[var(--ink)]')}
                >
                  <span>{owner.name}{owner.archivedAt ? ' (archivado)' : ''}</span>
                  {isSelected && <span aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}