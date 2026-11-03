import { useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { showToast } from '../lib/toast';
import { slugify, uuid } from '../lib/utils';
import type { CatalogConfig, UserProfile } from '../types';

const CURRENCIES = [
  { symbol: '$', label: 'Peso argentino ($)' },
  { symbol: 'US$', label: 'Dólar estadounidense (US$)' },
  { symbol: '€', label: 'Euro (€)' },
  { symbol: '$U', label: 'Peso uruguayo ($U)' },
  { symbol: 'CLP$', label: 'Peso chileno (CLP$)' },
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBusinessNameConflict(error: unknown): boolean {
  const message = errorMessage(error);
  return /profiles_business_name_lower_unique|business_name_lower.*(?:duplicate|unique)|duplicate key/i.test(message);
}

function defaultCatalogConfig(ownerUid: string, businessName: string, slug: string): CatalogConfig {
  return {
    id: uuid(),
    ownerUid,
    businessName,
    slug,
    enabled: true,
    showPrices: true,
    showStock: true,
    showStockQuantity: false,
    showOutOfStock: false,
    allowOrders: true,
    welcomeMessage: '¡Bienvenido a nuestra tienda!',
    primaryColor: '#6366f1',
    accentColor: '#6366f1',
    layout: 'Grid',
    fontStyle: 'Modern',
  };
}

export default function BusinessSetupModal() {
  const { user, isOwner, updateUser } = useAuth();
  const [businessName, setBusinessName] = useState('');
  const [currencySymbol, setCurrencySymbol] = useState<string>(CURRENCIES[0].symbol);
  const [phone, setPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const proposedSlug = useMemo(() => slugify(businessName.trim()) || 'tu-negocio', [businessName]);
  const shouldShow = Boolean(user && isOwner && !user.businessName.trim());

  if (!shouldShow || !user) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const trimmedName = businessName.trim();
    if (!trimmedName) {
      setError('Ingresá el nombre de tu negocio.');
      return;
    }

    const normalizedName = trimmedName.toLowerCase();
    setSaving(true);
    setError('');

    let catalogConfig: CatalogConfig | null = null;
    let createdCatalogConfigId: string | null = null;
    let updatedCatalogConfigBeforeSave: Pick<CatalogConfig, 'businessName' | 'slug'> | null = null;
    try {
      const existingBusinesses = await db.find<UserProfile>('users', 'businessNameLower', normalizedName, 1);
      if (existingBusinesses.some((profile) => profile.uid !== user.uid)) {
        setError('Este nombre de negocio ya está en uso. Elegí otro.');
        return;
      }

      const existingConfigs = await db.list<CatalogConfig>('catalog_configs', user.uid);
      catalogConfig = existingConfigs[0] ?? null;
      const baseSlug = slugify(trimmedName) || 'tienda';
      const matchingConfig = (await db.find<CatalogConfig>('catalog_configs', 'slug', baseSlug, 1))[0];
      const catalogSlug = matchingConfig && matchingConfig.ownerUid !== user.uid
        ? await db.getUniqueSlug(baseSlug, 'catalog_configs')
        : baseSlug;

      if (catalogConfig) {
        updatedCatalogConfigBeforeSave = {
          businessName: catalogConfig.businessName,
          slug: catalogConfig.slug,
        };
        await db.update<CatalogConfig>('catalog_configs', catalogConfig.id, {
          businessName: trimmedName,
          slug: catalogSlug,
        });
      } else {
        const created = await db.create<CatalogConfig>('catalog_configs', defaultCatalogConfig(user.uid, trimmedName, catalogSlug));
        catalogConfig = created;
        createdCatalogConfigId = created.id;
      }

      let updated: UserProfile;
      try {
        updated = await db.update<UserProfile>('users', user.uid, {
          businessName: trimmedName,
          businessNameLower: normalizedName,
          currencySymbol,
          phone: phone.trim(),
          email_contact: contactEmail.trim(),
          catalogSlug,
        });
      } catch (cause) {
        if (createdCatalogConfigId) {
          await db.delete('catalog_configs', createdCatalogConfigId).catch(() => undefined);
        } else if (catalogConfig && updatedCatalogConfigBeforeSave) {
          await db.update<CatalogConfig>('catalog_configs', catalogConfig.id, updatedCatalogConfigBeforeSave).catch(() => undefined);
        }
        throw cause;
      }

      updateUser(updated);
      showToast('Los datos del negocio quedaron guardados.', 'success');
    } catch (cause) {
      setError(isBusinessNameConflict(cause)
        ? 'Este nombre de negocio ya está en uso. Elegí otro.'
        : 'No se pudieron guardar los datos. Revisá la conexión y volvé a intentar.');
    } finally {
      setSaving(false);
    }
  };

  const preventDismiss = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4" onKeyDown={preventDismiss}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="business-setup-title"
        className="my-auto w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 sm:p-8"
      >
        <h2 id="business-setup-title" className="text-2xl font-black text-slate-900 dark:text-white">Completá los datos de tu negocio</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Necesitamos esta información para preparar tu cuenta y el enlace de tu catálogo.</p>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="business-setup-name" className="mb-1.5 block text-sm font-semibold text-slate-800 dark:text-slate-100">Nombre del negocio</label>
            <input
              id="business-setup-name"
              autoFocus
              required
              maxLength={100}
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              autoComplete="organization"
            />
          </div>

          <div>
            <label htmlFor="business-setup-currency" className="mb-1.5 block text-sm font-semibold text-slate-800 dark:text-slate-100">Moneda</label>
            <select
              id="business-setup-currency"
              value={currencySymbol}
              onChange={(event) => setCurrencySymbol(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              {CURRENCIES.map((currency) => <option key={currency.symbol} value={currency.symbol}>{currency.label}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="business-setup-phone" className="mb-1.5 block text-sm font-semibold text-slate-800 dark:text-slate-100">Teléfono de contacto</label>
            <input
              id="business-setup-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+54 9 11 1234-5678"
              autoComplete="tel"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div>
            <label htmlFor="business-setup-email" className="mb-1.5 block text-sm font-semibold text-slate-800 dark:text-slate-100">Email de contacto</label>
            <input
              id="business-setup-email"
              type="email"
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              placeholder="ventas@minegocio.com"
              autoComplete="email"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            Enlace sugerido para tu catálogo: <span className="mt-1 block break-all font-mono text-xs">{window.location.origin}/catalogo/{proposedSlug}</span>
          </p>

          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white transition-colors hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? 'Guardando…' : 'Guardar y continuar'}
          </button>
        </form>
      </section>
    </div>
  );
}
