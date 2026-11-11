# I53 — Resultados de la Etapa 0

Fecha: 11/11/2026. Relevamiento local, sin consultas ni escrituras en Supabase y sin cambios del producto.

## 1. Eventos de `runStreamed`

Se ejecutó un turno largo con el SDK fijado en el plan (`@openai/codex-sdk` 0.163.0), registrando evento, tipo de ítem, estado y cantidad de texto.

| Ejecución | Primer evento | `agent_message` parcial (`item.updated`) | Mensaje completo (`item.completed`) |
|---|---:|---:|---:|
| 1 | 1.56 s | 0 | 1 |
| 2 | 1.02 s | 0 | 1 |

En ambas ejecuciones el texto llegó completo en `item.completed`; no hubo texto parcial. En la segunda, el mensaje completo llegó a los 8.80 s y contenía 1,606 caracteres. Por la regla de decisión del plan, la Etapa 1 debe transmitir actividad y cada mensaje completo apenas llega, y la web debe revelarlo con efecto de escritura. No se debe fabricar streaming de texto que el SDK no entregó.

Script reproducible: `tools/rivastock-ai-bridge/scripts/stream-spike.ts` (`--mode=stream`).

## 2. MCP stdio desde el SDK

El SDK 0.163.0 reconoce la clave `mcp_servers` con `command`, `args` y `env`; inició el servidor de prueba como proceso stdio. La herramienta `ping` apareció como `mcp_tool_call`, pasó a `completed` y el asistente recibió la respuesta. El servidor registró la llamada `tools/call:ping`.

Configuración efectiva de la prueba: `approvalPolicy: 'never'`, `sandboxMode: 'read-only'`, `networkAccessEnabled: false`; en la configuración del servidor se declaró `default_tools_approval_mode: 'auto'`, y `ping` se marcó explícitamente como lectura, no destructiva e idempotente. El servidor solo devolvió una respuesta fija y el marcador de prueba quedó en una carpeta temporal que se eliminó al terminar.

**Hallazgo relevante:** `approvalPolicy: 'never'` por sí sola bloqueó la llamada con “MCP tool call requires approval”. Agregar solo aprobación automática al servidor tampoco alcanzó si la herramienta no estaba declarada como lectura. Con aprobación automática del servidor y las anotaciones de solo lectura, la llamada sí terminó en el entorno de lectura sin red. La implementación de la Etapa 3 debe mantener ambas condiciones y volver a verificarlas.

Script reproducible: `tools/rivastock-ai-bridge/scripts/stream-spike.ts` (`--mode=mcp`).

## 3. Mapa de datos derivado de migraciones

Columnas comprobadas en las migraciones del repositorio. El dueño de las 15 tablas es `user_id`; `products.inventory_owner_id` identifica además al dueño del inventario compartido, no reemplaza el ámbito del negocio. La columna “Escritura” indica RPC de escritura encontrada en las migraciones; “No identificada” significa que no se halló una RPC general para esa tabla y no afirma que la app no escriba directamente con RLS.

| Tabla | Dueño | Fechas | Estado / tipo | Importes / cantidades | RPC de escritura identificada |
|---|---|---|---|---|---|
| `products` | `user_id`; también `inventory_owner_id` para inventario compartido | `created_at`, `updated_at` | `catalog_only`, `show_in_catalog` | `purchase_price`, `sale_price`, `catalog_cost`; stock | `save_product_with_holdings`; stock y movimientos mediante RPC de inventario/ventas |
| `categories` | `user_id` | `created_at` | — | — | No general; limpieza de categorías de importación mediante `remove_reseller_supplier_import_batch` |
| `sales` | `user_id` | `date`, `created_at` | `status` | `unit_price`, `adjustment`, `total`, `shipping_amount` | `register_sale`, `edit_sale`, `toggle_sale_status`, `delete_sale` y variantes POS/atribuidas/envío |
| `sale_items` | `user_id` | `created_at`, `reversed_at` | Reversión: `reversed_at` (no tiene estado general) | `quantity`, `unit_price`, `unit_discount`, `discount_amount`, `adjustment_share`, `line_total` | RPC de ventas atribuidas: `register_attributed_sale`, `edit_attributed_sale` y helper de revisión |
| `orders` | `user_id` | `date`, `created_at` | `status` | `total`, `shipping_amount` | `create_public_catalog_order`, `create_public_reseller_supplier_round_order`, `create_public_super_offer_order`; no se identificó RPC general de cambio de estado |
| `customers` | `user_id` | `created_at`, `updated_at` | — | `current_balance` | `register_customer_payment`, `register_customer_payment_v2`, `register_customer_adjustment`; RPC de ventas también afecta saldo |
| `stock_movements` | `user_id` | `created_at` | `movement_type` | `delta`, `resulting_stock`, `unit_cost_snapshot` | `attribute_current_sale_revision`, `reverse_current_sale_revision` y RPC de movimientos/stock |
| `catalog_config` | `user_id` | `updated_at` | `enabled` y opciones de visualización | — | No identificada; la app persiste la configuración directamente |
| `price_lists` | `user_id` | `created_at`, `updated_at` | `kind`, `public_enabled` | `minimum_order_amount`, `default_discount_percent`, `minimum_profit_margin_percent`, `target_reseller_discount_percent` | `ensure_reseller_price_list`, `save_reseller_price_list`, `configure_reseller_price_list`, `configure_reseller_pricing_advisor` |
| `price_list_items` | `user_id` | `created_at`, `updated_at` | `availability` | `fixed_price`, `discount_percent` | `add_reseller_price_list_product`, `save_reseller_price_list` y RPC de precios de listas de proveedores |
| `reseller_supplier_lists` | `user_id` | `created_at`, `updated_at` | `enabled` | — | `save_reseller_supplier_list`, `toggle_reseller_supplier_list` |
| `reseller_supplier_list_items` | `user_id` | `created_at` | — | — | `save_reseller_supplier_list`, `promote_reseller_catalog_product`, y RPC de limpieza de importación |
| `supplier_orders` | `user_id` | `ordered_on`, `received_at`, `created_at`, `updated_at` | `status` | No hay importe en la tabla | No identificada; el esquema permite operaciones de tabla sujetas a sus políticas |
| `cash_flow` | `user_id` | `date`, `created_at` | `status`, `type` | `amount` | RPC de ventas, pagos y ajustes de clientes |
| `facebook_publications` | `user_id` | `approved_at` | El estado de entrega vive en `facebook_deliveries` | — | `approve_facebook_publication` y v2 |

## Verificaciones del entorno

- `npm run lint`: pasó.
- `npm run build`: pasó; generó los artefactos locales habituales de build, sin cambios de producto versionados.
- `tools/rivastock-ai-bridge`: `npm run typecheck` pasó y `npm test` pasó (125/125).
- Suite raíz `npm test`: no quedó verde en este worktree. Resultado: 13 archivos de prueba fallidos y 229 pasaron; 3 pruebas fallidas y 1,363 pasaron. Diez suites no pudieron inicializarse porque el entorno de prueba no tiene `VITE_SUPABASE_URL` ni `VITE_SUPABASE_PUBLISHABLE_KEY`; tres pruebas de migración agotaron el timeout al iniciar PGlite. No se añadieron credenciales ni se cambiaron pruebas o código para ocultar los fallos.
- No se desplegó: Etapa 0 no produce cambios de producto y su instrucción explícita es frenar y reportar.

## Alcance y siguiente paso

No se consultó producción, no se aplicaron migraciones y no se modificaron datos ni código del producto. El único código agregado es el script reproducible de esta prueba. La Etapa 0 queda informada; no se inició la Etapa 1.
