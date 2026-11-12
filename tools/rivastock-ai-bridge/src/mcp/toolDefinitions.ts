export type ToolModule = 'stock' | 'sales' | 'orders' | 'customers' | 'resellers' | 'knowledge' | null;

export interface ReadToolDefinition {
  name: string;
  description: string;
  module: ToolModule;
  inputSchema: Record<string, unknown>;
}

const uuid = { type: 'string', format: 'uuid' };
const date = { type: 'string', format: 'date' };

export const CHANGE_PREVIEW_TOOL: ReadToolDefinition = {
  name: 'previsualizar_cambio',
  description: `Previsualiza un cambio posible en RivaStock sin guardar ni modificar datos. Solo usala si el usuario pidió claramente ese cambio. Elegí una acción y enviá únicamente los parámetros exactos permitidos para esa acción; no agregues parámetros que no estén en la lista.\n\nAcciones y parámetros:\n- product.create: requeridos nombre, precio_venta; opcionales categoria, descripcion, stock_inicial, mostrar_en_catalogo.\n- product.update: requeridos product_id y al menos uno de nombre, descripcion, categoria, precio_venta, mostrar_en_catalogo.\n- stock.adjust: requeridos product_id, cantidad, motivo.\n- price.bulk_update: requeridos filtro, tipo, valor; opcional redondeo. filtro requiere exactamente categoria o product_ids.\n- catalog.announcement: requeridos texto, activa.\n- knowledge.create_document: requeridos titulo, contenido_markdown.\nEjemplo: {"accion":"product.update","parametros":{"product_id":"<uuid>","precio_venta":12500}}. La vista previa no crea una propuesta por sí sola; la propuesta requiere que el usuario haya pedido el cambio.`,
  module: null,
  inputSchema: {
    type: 'object',
    properties: {
      accion: { type: 'string', enum: ['product.update', 'product.create', 'stock.adjust', 'price.bulk_update', 'catalog.announcement', 'knowledge.create_document'] },
      parametros: { type: 'object' },
    },
    oneOf: [
      { properties: { accion: { const: 'product.create' }, parametros: { type: 'object', properties: {
        nombre: { type: 'string', minLength: 1, maxLength: 160 }, precio_venta: { type: 'number', exclusiveMinimum: 0 },
        categoria: { type: 'string', maxLength: 120 }, descripcion: { type: 'string', maxLength: 2000 },
        stock_inicial: { type: 'integer', minimum: 0, maximum: 1000000 }, mostrar_en_catalogo: { type: 'boolean' },
      }, required: ['nombre', 'precio_venta'], additionalProperties: false } }, required: ['accion', 'parametros'] },
      { properties: { accion: { const: 'product.update' }, parametros: { type: 'object', properties: {
        product_id: uuid, nombre: { type: 'string', minLength: 1, maxLength: 160 }, descripcion: { type: 'string', maxLength: 2000 },
        categoria: { type: 'string', maxLength: 120 }, precio_venta: { type: 'number', exclusiveMinimum: 0 }, mostrar_en_catalogo: { type: 'boolean' },
      }, required: ['product_id'], anyOf: [{ required: ['nombre'] }, { required: ['descripcion'] }, { required: ['categoria'] }, { required: ['precio_venta'] }, { required: ['mostrar_en_catalogo'] }], additionalProperties: false } }, required: ['accion', 'parametros'] },
      { properties: { accion: { const: 'stock.adjust' }, parametros: { type: 'object', properties: {
        product_id: uuid, cantidad: { type: 'integer', minimum: -1000000, maximum: 1000000, not: { const: 0 } }, motivo: { type: 'string', minLength: 1, maxLength: 300 },
      }, required: ['product_id', 'cantidad', 'motivo'], additionalProperties: false } }, required: ['accion', 'parametros'] },
      { properties: { accion: { const: 'price.bulk_update' }, parametros: { type: 'object', properties: {
        filtro: { type: 'object', properties: { categoria: { type: 'string', minLength: 1, maxLength: 120 }, product_ids: { type: 'array', minItems: 1, maxItems: 200, items: uuid } }, oneOf: [{ required: ['categoria'] }, { required: ['product_ids'] }], additionalProperties: false },
        tipo: { type: 'string', enum: ['porcentaje', 'monto'] }, valor: { type: 'number' }, redondeo: { type: 'integer', enum: [1, 10, 50, 100, 500, 1000] },
      }, required: ['filtro', 'tipo', 'valor'], additionalProperties: false } }, required: ['accion', 'parametros'] },
      { properties: { accion: { const: 'catalog.announcement' }, parametros: { type: 'object', properties: {
        texto: { type: 'string', maxLength: 120 }, activa: { type: 'boolean' },
      }, required: ['texto', 'activa'], additionalProperties: false } }, required: ['accion', 'parametros'] },
      { properties: { accion: { const: 'knowledge.create_document' }, parametros: { type: 'object', properties: {
        titulo: { type: 'string', minLength: 1, maxLength: 160 }, contenido_markdown: { type: 'string', minLength: 1, maxLength: 500000 },
      }, required: ['titulo', 'contenido_markdown'], additionalProperties: false } }, required: ['accion', 'parametros'] },
    ],
    required: ['accion', 'parametros'],
    additionalProperties: false,
  },
};

export const READ_TOOLS: ReadToolDefinition[] = [
  { name: 'negocio_resumen', description: 'Consulta el resumen y los datos básicos del negocio.', module: null, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'productos_buscar', description: 'Busca productos y filtra por categoría, stock o datos faltantes.', module: 'stock', inputSchema: { type: 'object', properties: { texto: { type: 'string', maxLength: 120 }, categoria: { type: 'string', maxLength: 120 }, filtro: { type: 'string', enum: ['sin_stock', 'stock_bajo', 'sin_foto', 'sin_precio'] }, orden: { type: 'string', enum: ['nombre', 'precio', 'stock'] }, pagina: { type: 'integer', minimum: 1, maximum: 1000 } }, additionalProperties: false } },
  { name: 'producto_ver', description: 'Consulta la ficha de un producto del negocio.', module: 'stock', inputSchema: { type: 'object', properties: { product_id: uuid }, required: ['product_id'], additionalProperties: false } },
  { name: 'categorias_listar', description: 'Lista las categorías y cuántos productos tiene cada una.', module: 'stock', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'ventas_resumen', description: 'Resume las ventas dentro de un período de hasta 366 días.', module: 'sales', inputSchema: { type: 'object', properties: { desde: date, hasta: date }, required: ['desde', 'hasta'], additionalProperties: false } },
  { name: 'ventas_listar', description: 'Lista ventas dentro de un período de hasta 366 días.', module: 'sales', inputSchema: { type: 'object', properties: { desde: date, hasta: date, pagina: { type: 'integer', minimum: 1, maximum: 1000 } }, required: ['desde', 'hasta'], additionalProperties: false } },
  { name: 'productos_mas_vendidos', description: 'Muestra los productos más vendidos dentro de un período.', module: 'sales', inputSchema: { type: 'object', properties: { desde: date, hasta: date, limite: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['desde', 'hasta'], additionalProperties: false } },
  { name: 'pedidos_listar', description: 'Lista pedidos del catálogo o de revendedores.', module: 'orders', inputSchema: { type: 'object', properties: { estado: { type: 'string', enum: ['Nuevo', 'En Proceso', 'Entregado', 'Cancelado'] }, origen: { type: 'string', enum: ['catalogo', 'revendedor'] }, pagina: { type: 'integer', minimum: 1, maximum: 1000 } }, additionalProperties: false } },
  { name: 'pedido_ver', description: 'Consulta un pedido por su identificador o código.', module: 'orders', inputSchema: { type: 'object', properties: { order_id: uuid, codigo: { type: 'string', minLength: 1, maxLength: 40 } }, additionalProperties: false, anyOf: [{ required: ['order_id'] }, { required: ['codigo'] }] } },
  { name: 'clientes_buscar', description: 'Busca clientes por nombre o teléfono.', module: 'customers', inputSchema: { type: 'object', properties: { texto: { type: 'string', minLength: 1, maxLength: 120 }, pagina: { type: 'integer', minimum: 1, maximum: 1000 } }, required: ['texto'], additionalProperties: false } },
  { name: 'catalogo_config', description: 'Consulta el enlace público y las opciones generales del catálogo.', module: null, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'lista_revendedores_buscar', description: 'Busca productos de la lista de revendedores; no muestra información del proveedor.', module: 'resellers', inputSchema: { type: 'object', properties: { texto: { type: 'string', maxLength: 120 }, pagina: { type: 'integer', minimum: 1, maximum: 1000 } }, additionalProperties: false } },
  { name: 'stock_movimientos', description: 'Consulta los movimientos recientes de stock de un producto.', module: 'stock', inputSchema: { type: 'object', properties: { product_id: uuid, limite: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['product_id'], additionalProperties: false } },
  { name: 'conocimiento_buscar', description: 'Busca información en los documentos publicados de Conocimientos.', module: 'knowledge', inputSchema: { type: 'object', properties: { consulta: { type: 'string', minLength: 2, maxLength: 500 } }, required: ['consulta'], additionalProperties: false } },
];

export function findReadTool(name: string): ReadToolDefinition | undefined {
  return READ_TOOLS.find((tool) => tool.name === name);
}

export function validateToolArguments(tool: ReadToolDefinition, value: unknown): value is Record<string, unknown> {
  if (tool.name === CHANGE_PREVIEW_TOOL.name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const args = value as Record<string, unknown>;
    if (Object.keys(args).some((key) => key !== 'accion' && key !== 'parametros')
      || typeof args.accion !== 'string' || !args.parametros || typeof args.parametros !== 'object' || Array.isArray(args.parametros)) return false;
    const params = args.parametros as Record<string, unknown>;
    const allowed: Record<string, string[]> = {
      'product.update': ['product_id', 'nombre', 'descripcion', 'categoria', 'precio_venta', 'mostrar_en_catalogo'],
      'product.create': ['nombre', 'precio_venta', 'categoria', 'descripcion', 'stock_inicial', 'mostrar_en_catalogo'],
      'stock.adjust': ['product_id', 'cantidad', 'motivo'], 'price.bulk_update': ['filtro', 'tipo', 'valor', 'redondeo'],
      'catalog.announcement': ['texto', 'activa'], 'knowledge.create_document': ['titulo', 'contenido_markdown'],
    };
    return args.accion in allowed && Object.keys(params).every((key) => allowed[args.accion as string]?.includes(key))
      && validateChangeParameters(args.accion, params);
  }
  return validateReadToolArguments(tool, value);
}

function validateChangeParameters(action: string, params: Record<string, unknown>): boolean {
  const isString = (key: string, minimum: number, maximum: number) => typeof params[key] === 'string'
    && (params[key] as string).trim().length >= minimum && (params[key] as string).length <= maximum;
  const isOptionalString = (key: string, maximum: number) => !(key in params) || (typeof params[key] === 'string' && (params[key] as string).length <= maximum);
  const isOptionalBoolean = (key: string) => !(key in params) || typeof params[key] === 'boolean';
  const isUuid = (value: unknown) => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const isPrice = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;
  switch (action) {
    case 'product.create':
      return isString('nombre', 1, 160) && isPrice(params.precio_venta)
        && isOptionalString('categoria', 120) && isOptionalString('descripcion', 2000)
        && (!('stock_inicial' in params) || (Number.isInteger(params.stock_inicial) && Number(params.stock_inicial) >= 0 && Number(params.stock_inicial) <= 1_000_000))
        && isOptionalBoolean('mostrar_en_catalogo');
    case 'product.update':
      return isUuid(params.product_id)
        && ['nombre', 'descripcion', 'categoria', 'precio_venta', 'mostrar_en_catalogo'].some((key) => key in params)
        && isOptionalString('nombre', 160) && (!('nombre' in params) || (params.nombre as string).trim().length > 0)
        && isOptionalString('descripcion', 2000) && isOptionalString('categoria', 120)
        && (!('precio_venta' in params) || isPrice(params.precio_venta)) && isOptionalBoolean('mostrar_en_catalogo');
    case 'stock.adjust':
      return isUuid(params.product_id) && Number.isInteger(params.cantidad) && Number(params.cantidad) !== 0
        && Math.abs(Number(params.cantidad)) <= 1_000_000 && isString('motivo', 1, 300);
    case 'price.bulk_update': {
      if (!params.filtro || typeof params.filtro !== 'object' || Array.isArray(params.filtro)
        || !['porcentaje', 'monto'].includes(String(params.tipo)) || typeof params.valor !== 'number' || !Number.isFinite(params.valor)
        || ('redondeo' in params && ![1, 10, 50, 100, 500, 1000].includes(Number(params.redondeo)))) return false;
      const filter = params.filtro as Record<string, unknown>;
      return Object.keys(filter).every((key) => key === 'categoria' || key === 'product_ids')
        && (('categoria' in filter && isStringValue(filter.categoria, 1, 120) && !('product_ids' in filter))
          || ('product_ids' in filter && Array.isArray(filter.product_ids) && filter.product_ids.length > 0
            && filter.product_ids.length <= 200 && filter.product_ids.every(isUuid)
            && new Set(filter.product_ids).size === filter.product_ids.length && !('categoria' in filter)));
    }
    case 'catalog.announcement':
      return typeof params.texto === 'string' && params.texto.length <= 120 && typeof params.activa === 'boolean';
    case 'knowledge.create_document':
      return isString('titulo', 1, 160) && isString('contenido_markdown', 1, 500_000);
    default: return false;
  }
}

function isStringValue(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length >= minimum && value.length <= maximum;
}

export function validateReadToolArguments(tool: ReadToolDefinition, value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const args = value as Record<string, unknown>;
  const schema = tool.inputSchema;
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required ?? []) as string[];
  if (required.some((key) => !(key in args))) return false;
  if (schema.additionalProperties === false && Object.keys(args).some((key) => !(key in properties))) return false;
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((item) => {
    const keys = ((item as { required?: string[] }).required ?? []);
    return keys.every((key) => key in args);
  })) return false;
  for (const [key, input] of Object.entries(args)) {
    const rule = properties[key];
    if (!rule) continue;
    if (rule.type === 'string') {
      if (typeof input !== 'string') return false;
      if (typeof rule.minLength === 'number' && input.length < rule.minLength) return false;
      if (typeof rule.maxLength === 'number' && input.length > rule.maxLength) return false;
      if (Array.isArray(rule.enum) && !rule.enum.includes(input)) return false;
      if (rule.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)) return false;
      if (rule.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(input) || Number.isNaN(Date.parse(`${input}T00:00:00Z`)))) return false;
    } else if (rule.type === 'integer') {
      if (!Number.isInteger(input)) return false;
      if (typeof rule.minimum === 'number' && (input as number) < rule.minimum) return false;
      if (typeof rule.maximum === 'number' && (input as number) > rule.maximum) return false;
    }
  }
  return true;
}

export function readToolMcpDefinitions() {
  return READ_TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }));
}

export function changePreviewMcpDefinition() {
  return {
    name: CHANGE_PREVIEW_TOOL.name,
    description: CHANGE_PREVIEW_TOOL.description,
    inputSchema: CHANGE_PREVIEW_TOOL.inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  };
}
