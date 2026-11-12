export type ToolModule = 'stock' | 'sales' | 'orders' | 'customers' | 'resellers' | 'knowledge' | null;

export interface ReadToolDefinition {
  name: string;
  description: string;
  module: ToolModule;
  inputSchema: Record<string, unknown>;
}

export const CHANGE_PREVIEW_TOOL: ReadToolDefinition = {
  name: 'previsualizar_cambio',
  description: 'Previsualiza un cambio posible en RivaStock. No guarda ni modifica datos. Solo propone un cambio si el usuario lo pidió claramente.',
  module: null,
  inputSchema: {
    type: 'object',
    properties: {
      accion: { type: 'string', enum: ['product.update', 'product.create', 'stock.adjust', 'price.bulk_update', 'catalog.announcement', 'knowledge.create_document'] },
      parametros: { type: 'object' },
    },
    required: ['accion', 'parametros'],
    additionalProperties: false,
  },
};

const uuid = { type: 'string', format: 'uuid' };
const date = { type: 'string', format: 'date' };

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
    return Object.keys(args).every((key) => key === 'accion' || key === 'parametros')
      && typeof args.accion === 'string'
      && (CHANGE_PREVIEW_TOOL.inputSchema.properties as Record<string, { enum: string[] }>).accion.enum.includes(args.accion)
      && Boolean(args.parametros) && typeof args.parametros === 'object' && !Array.isArray(args.parametros);
  }
  return validateReadToolArguments(tool, value);
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
