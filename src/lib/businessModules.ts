export type BusinessModuleKey =
  | 'sales' | 'quotes' | 'orders' | 'quickPrice'
  | 'stock' | 'intake' | 'sendPhotos'
  | 'customers' | 'suppliers' | 'resellers' | 'supplierOrders'
  | 'cash' | 'reports' | 'calculator'
  | 'ai' | 'knowledge' | 'automation' | 'traceability';

interface BusinessModuleDefinition {
  key: BusinessModuleKey;
  label: string;
  dependencies: BusinessModuleKey[];
}

interface BusinessModuleGroup {
  label: string;
  modules: BusinessModuleDefinition[];
}

export const BUSINESS_MODULE_GROUPS: BusinessModuleGroup[] = [
  {
    label: 'Vender',
    modules: [
      { key: 'sales', label: 'Ventas', dependencies: ['stock'] },
      { key: 'quotes', label: 'Presupuestos', dependencies: ['stock'] },
      { key: 'orders', label: 'Pedidos', dependencies: ['sales'] },
      { key: 'quickPrice', label: 'Consulta rápida', dependencies: ['stock'] },
    ],
  },
  {
    label: 'Productos',
    modules: [
      { key: 'stock', label: 'Stock', dependencies: [] },
      { key: 'intake', label: 'Ingresos de mercadería', dependencies: ['stock'] },
      { key: 'sendPhotos', label: 'Buscar y enviar', dependencies: ['stock'] },
    ],
  },
  {
    label: 'Clientes y proveedores',
    modules: [
      { key: 'customers', label: 'Clientes', dependencies: [] },
      { key: 'suppliers', label: 'Proveedores', dependencies: [] },
      { key: 'resellers', label: 'Revendedores', dependencies: ['stock', 'suppliers'] },
      { key: 'supplierOrders', label: 'Compras a proveedores', dependencies: ['stock', 'suppliers'] },
    ],
  },
  {
    label: 'Dinero',
    modules: [
      { key: 'cash', label: 'Flujo de Caja', dependencies: [] },
      { key: 'reports', label: 'Reportes', dependencies: ['sales'] },
      { key: 'calculator', label: 'Calculadora', dependencies: [] },
    ],
  },
  {
    label: 'Herramientas',
    modules: [
      { key: 'ai', label: 'IA', dependencies: [] },
      { key: 'knowledge', label: 'Conocimientos', dependencies: [] },
      { key: 'automation', label: 'Automatizaciones', dependencies: ['stock'] },
      { key: 'traceability', label: 'Trazabilidad', dependencies: [] },
    ],
  },
];

export type BusinessModules = Record<BusinessModuleKey, boolean>;
export type PartialBusinessModules = Partial<Record<BusinessModuleKey, boolean>>;

export const BUSINESS_MODULES = BUSINESS_MODULE_GROUPS.flatMap(group => group.modules);
export const BUSINESS_MODULE_KEYS = BUSINESS_MODULES.map(module => module.key) as BusinessModuleKey[];
export const BUSINESS_MODULE_LABELS = Object.fromEntries(BUSINESS_MODULES.map(module => [module.key, module.label])) as Record<BusinessModuleKey, string>;

export const DEFAULT_BUSINESS_MODULES: BusinessModules = {
  sales: true,
  quotes: true,
  orders: true,
  quickPrice: true,
  stock: true,
  intake: true,
  sendPhotos: true,
  customers: true,
  suppliers: true,
  resellers: true,
  supplierOrders: true,
  cash: true,
  reports: true,
  calculator: true,
  ai: false,
  knowledge: false,
  automation: false,
  traceability: true,
};

export function normalizeBusinessModules(value: unknown): BusinessModules {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(BUSINESS_MODULE_KEYS.map(key => [
    key,
    typeof source[key] === 'boolean' ? source[key] : DEFAULT_BUSINESS_MODULES[key],
  ])) as BusinessModules;
}

export function getBusinessModuleDependencies(key: BusinessModuleKey): BusinessModuleKey[] {
  const module = BUSINESS_MODULES.find(item => item.key === key);
  return module ? [...module.dependencies] : [];
}

export function getBusinessModuleDisableBlockers(modules: PartialBusinessModules, key: BusinessModuleKey): BusinessModuleKey[] {
  return BUSINESS_MODULES
    .filter(module => modules[module.key] === true && module.dependencies.includes(key))
    .map(module => module.key);
}

export function getBusinessModuleEnableRequirements(modules: PartialBusinessModules, key: BusinessModuleKey): BusinessModuleKey[] {
  return getBusinessModuleDependencies(key).filter(dependency => modules[dependency] !== true);
}
