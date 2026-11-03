# Auditoría de aislamiento multi-negocio — F1

**Fecha:** 2 de noviembre de 2026 (ART)
**Entorno:** producción `RivaStock_Oficial` (`nkfqhuqrgrpfufdymkcr`)
**Estado:** completada después de aplicar las dos migraciones aditivas y repetir las simulaciones.

## Método y resultado

Se enumeraron las relaciones de `public` a partir de `information_schema`: **85 en total (82 tablas y 3 vistas)**. Se comprobó RLS en cada tabla, los grants y las políticas de las tablas y de Storage, y las funciones `SECURITY DEFINER` ejecutables por `anon` o `authenticated` que reciben identificadores de dueño.

Las lecturas se simularon dentro de transacciones que terminaron con `ROLLBACK`. Para `authenticated` se usó un UUID aleatorio cuya ausencia en `auth.users` se comprobó justo antes; se fijaron `request.jwt.claim.sub` y `request.jwt.claims`. Se repitió con el rol `anon`. La consulta contó cada relación con permiso de lectura; donde no existe grant de `SELECT`, el resultado se registra como “sin SELECT”. Las pruebas no insertaron ni actualizaron datos.

| Rol simulado | Relaciones con SELECT | Sin grant de SELECT | Relaciones con filas visibles |
|---|---:|---:|---|
| `authenticated`, UID nuevo inexistente | 71 | 14 | 2 |
| `anon` | 27 | 58 | 2 |

En ambos roles las únicas filas visibles fueron las globales de catálogo: `catalog_config` (4) y `categories` (14). Sus políticas limitan la lectura a la configuración de catálogo habilitada y a las categorías de catálogos públicos habilitados. Las otras **69** relaciones legibles por el dueño nuevo y **25** legibles por `anon` devolvieron cero filas. La matriz completa está al final.

## Hallazgos y correcciones

### Enlaces públicos de cotización

La política `quotes_public_read_by_id` usaba `USING (true)`; una consulta anónima y otra como dueño nuevo llegaron a leer una fila de `quotes`, aunque solo se necesita mostrar una cotización por el UUID incluido en su enlace. Además, `quotes_with_status` era una vista con privilegios del dueño y su grant permitía evitar la RLS de la tabla.

La migración `20261102210803_quotes_public_access_rpc` quitó la política abierta y el acceso directo anónimo a `quotes`; también retiró el acceso a `quotes_with_status`. La función `get_public_quote(uuid)` expone únicamente la proyección necesaria para un enlace cuyo UUID se conoce y devuelve como máximo esa cotización. El UUID funciona como token portador del enlace. Los dueños conservan el acceso autenticado a sus filas. `QuotePublic.tsx` ahora usa la RPC, y la prueba SQL local cubre enumeración denegada, campos acotados, enlace desconocido vacío y lectura autenticada del dueño.

### Vista de perfiles

`public_profiles` exponía perfiles de negocio con datos de contacto a `anon` y `authenticated`. Ya no hay referencias a esa vista en la aplicación: la información necesaria para la cotización pública se entrega en la proyección limitada anterior. La migración `20261102212233_revoke_unused_public_profiles` revocó todos sus grants. Las simulaciones posteriores confirman que ambos roles reciben permiso denegado.

## RLS, políticas y funciones

- **0** tablas de `public` tienen RLS desactivado.
- Se revisaron **144** políticas de `public` y **10** políticas de Storage. No quedan políticas de lectura o escritura para `anon`/ `authenticated` con `USING (true)`, `WITH CHECK (true)` ni sin una condición de ámbito.
- Las excepciones públicas son deliberadas: lectura del catálogo habilitado y lectura pública de fotos en el bucket `assets`. Las escrituras de `assets` exigen carpeta del dueño y permisos; `knowledge` y `supplier-order-documents` usan ruta del dueño y permisos. `automation-traces` no tiene lectura pública.
- Las políticas indirectas de revisiones y entregas de Facebook dependen de relaciones que ya aplican RLS del negocio. Las actualizaciones de `assets` reutilizan el predicado de dueño y permisos como comprobación de fila.
- Se revisaron las funciones `SECURITY DEFINER` con `EXECUTE` otorgado a `anon` o `authenticated` que aceptan identificadores de dueño. Cada ruta encontrada valida el usuario contra `auth.uid()` o `get_owner_uid()` y los permisos del negocio; no se encontró una ruta invocable que omita esa validación. La RPC pública de cotización acepta un UUID de cotización como token de enlace, no un ID de dueño, y limita las columnas devueltas.

## Registro de cuentas

La lectura de solo lectura de `/auth/v1/settings` con la clave publishable confirmó `disable_signup = true`. No se cambió la configuración. **Desvío:** el plan pedía Management API; no había token de Management API configurado en la CLI, así que se consultó el endpoint público de ajustes Auth, que informa directamente el booleano efectivo. No se expusieron claves ni se modificó Auth. Con el registro público desactivado no se necesita acción del dueño.

## Migraciones y respaldos

Cada migración tuvo un respaldo nuevo, íntegro y verificado antes de aplicarse. Los backups están fuera del repositorio en `%USERPROFILE%\rivastock-backups\`.

| Migración | Backup previo verificado | Resultado |
|---|---|---|
| `20261102210803_quotes_public_access_rpc` | `20261103T001144Z`: 82 tablas, 13.774 filas; 374 objetos de Storage (132.374.670 B) | aplicada a producción |
| `20261102212233_revoke_unused_public_profiles` | `20261103T002252Z`: 82 tablas, 13.774 filas; 374 objetos de Storage (132.374.670 B) | aplicada a producción |

En ambos respaldos la exportación incluyó esquema, datos, conteos exactos por tabla y objetos de Storage; la suma de conteos coincidió con las filas exportadas. El inventario y los tamaños de Storage coincidieron. La CLI confirma ambas migraciones al final de la lista remota.

## Verificación

- `npm run lint`: aprobado.
- `npm test -- --maxWorkers=1`: **668/668** pruebas en **108** archivos, aprobado.
- Prueba dirigida `src/lib/financialSql.test.ts`: **18/18**, aprobada.
- `npm run build`: aprobado.
- `npm run perf:check`: aprobado; inicio **207.869 B gzip JS** y **21.807 B gzip CSS**.
- Repetición en producción después de ambas migraciones: 85 relaciones por rol; sin filas visibles para un UID nuevo fuera de los dos catálogos globales. `quotes`, `quotes_with_status` y `public_profiles` ya no son seleccionables por `anon`; las vistas sensibles también están denegadas a `authenticated`.
- No se crearon datos QA. No hubo cambios de Auth ni escrituras de negocio.

**Pendiente de despliegue al redactar:** publicar `QuotePublic.tsx` en Vercel y confirmar el deploy antes de cerrar F1 en `ACTION_PLAN.md`.

## Matriz de conteos por relación

“Sin SELECT” indica que el rol no tiene grant directo sobre la relación; los demás valores son `count(*)` con la RLS activa. La columna “authenticated nuevo” corresponde al UUID aleatorio inexistente y no registra ni muestra ese UUID.

| Relación | Tipo | anon | authenticated nuevo |
|---|---|---:|---:|
| `ai_bridge_device_secrets` | tabla | sin SELECT | sin SELECT |
| `ai_bridge_devices` | tabla | sin SELECT | sin SELECT |
| `ai_bridge_workers` | tabla | sin SELECT | 0 |
| `ai_chat_messages` | tabla | sin SELECT | 0 |
| `ai_chat_tombstones` | tabla | sin SELECT | sin SELECT |
| `ai_chats` | tabla | sin SELECT | sin SELECT |
| `ai_function_settings` | tabla | sin SELECT | 0 |
| `ai_history_settings` | tabla | sin SELECT | 0 |
| `ai_job_knowledge_sources` | tabla | sin SELECT | 0 |
| `ai_jobs` | tabla | sin SELECT | 0 |
| `ai_memories` | tabla | sin SELECT | 0 |
| `ai_memory_events` | tabla | sin SELECT | 0 |
| `ai_memory_job_claims` | tabla | sin SELECT | sin SELECT |
| `ai_memory_metrics` | tabla | sin SELECT | 0 |
| `ai_memory_settings` | tabla | sin SELECT | 0 |
| `ai_workspace_files` | tabla | sin SELECT | 0 |
| `attributed_sale_commands` | tabla | sin SELECT | sin SELECT |
| `audit_events` | tabla | 0 | 0 |
| `cash_closings` | tabla | 0 | 0 |
| `cash_flow` | tabla | 0 | 0 |
| `cash_flow_allocations` | tabla | sin SELECT | 0 |
| `catalog_config` | tabla | 4 | 4 |
| `categories` | tabla | 14 | 14 |
| `collaborators` | tabla | 0 | 0 |
| `customer_financial_commands` | tabla | sin SELECT | sin SELECT |
| `customer_transactions` | tabla | 0 | 0 |
| `customers` | tabla | 0 | 0 |
| `facebook_deliveries` | tabla | sin SELECT | 0 |
| `facebook_delivery_attempt_events` | tabla | sin SELECT | 0 |
| `facebook_delivery_attempts` | tabla | sin SELECT | 0 |
| `facebook_delivery_decisions` | tabla | sin SELECT | 0 |
| `facebook_delivery_reviews` | tabla | sin SELECT | 0 |
| `facebook_device_secrets` | tabla | sin SELECT | sin SELECT |
| `facebook_devices` | tabla | sin SELECT | 0 |
| `facebook_group_sync` | tabla | sin SELECT | 0 |
| `facebook_groups` | tabla | sin SELECT | 0 |
| `facebook_publications` | tabla | sin SELECT | 0 |
| `facebook_worker_policy` | tabla | sin SELECT | 0 |
| `fb_delivery_group_results` | tabla | sin SELECT | 0 |
| `fb_learned_hints` | tabla | sin SELECT | sin SELECT |
| `fb_rehearsals` | tabla | sin SELECT | 0 |
| `fb_run_traces` | tabla | sin SELECT | 0 |
| `fb_supervision_requests` | tabla | sin SELECT | 0 |
| `fb_trace_cleanup_state` | tabla | sin SELECT | sin SELECT |
| `fb_trace_steps` | tabla | sin SELECT | 0 |
| `fb_trace_storage_reservations` | tabla | sin SELECT | sin SELECT |
| `inventory_holdings` | tabla | 0 | 0 |
| `inventory_movements_view` | vista | 0 | 0 |
| `inventory_operation_settings` | tabla | 0 | 0 |
| `inventory_owner_memberships` | tabla | 0 | 0 |
| `inventory_owners` | tabla | 0 | 0 |
| `inventory_product_commands` | tabla | 0 | 0 |
| `inventory_stock_commands` | tabla | 0 | 0 |
| `invitations` | tabla | 0 | 0 |
| `knowledge_ai_proposals` | tabla | sin SELECT | 0 |
| `knowledge_assets` | tabla | sin SELECT | 0 |
| `knowledge_categories` | tabla | sin SELECT | 0 |
| `knowledge_chunks` | tabla | sin SELECT | sin SELECT |
| `knowledge_document_tags` | tabla | sin SELECT | 0 |
| `knowledge_document_versions` | tabla | sin SELECT | 0 |
| `knowledge_documents` | tabla | sin SELECT | 0 |
| `knowledge_events` | tabla | sin SELECT | 0 |
| `knowledge_folders` | tabla | sin SELECT | 0 |
| `knowledge_index_jobs` | tabla | sin SELECT | 0 |
| `knowledge_search_requests` | tabla | sin SELECT | 0 |
| `knowledge_settings` | tabla | sin SELECT | 0 |
| `knowledge_tags` | tabla | sin SELECT | 0 |
| `orders` | tabla | 0 | 0 |
| `price_list_items` | tabla | 0 | 0 |
| `price_lists` | tabla | 0 | 0 |
| `price_ranges` | tabla | 0 | 0 |
| `products` | tabla | sin SELECT | 0 |
| `profiles` | tabla | 0 | 0 |
| `public_profiles` | vista | sin SELECT | sin SELECT |
| `quotes` | tabla | sin SELECT | 0 |
| `quotes_with_status` | vista | sin SELECT | sin SELECT |
| `reseller_supplier_list_items` | tabla | 0 | 0 |
| `reseller_supplier_lists` | tabla | 0 | 0 |
| `sale_item_allocations` | tabla | sin SELECT | 0 |
| `sale_items` | tabla | sin SELECT | 0 |
| `sales` | tabla | 0 | 0 |
| `stock_intakes` | tabla | 0 | 0 |
| `stock_movements` | tabla | sin SELECT | 0 |
| `supplier_orders` | tabla | 0 | 0 |
| `suppliers` | tabla | 0 | 0 |
