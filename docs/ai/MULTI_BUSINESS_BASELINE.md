# Línea base multi-negocio — E0

**Fecha:** 2 de noviembre de 2026 (ART)
**Entorno:** producción `RivaStock_Oficial`
**Método:** consultas SQL de solo lectura. No hubo cambios en datos ni esquema.

## Uso del proyecto

- Base de datos: **75.779.219 B**.
- Tope recomendado de base del plan Free: **500 MB** por proyecto. Presupuesto de alerta al 90 %: **471.859.200 B** (450 MiB). Uso actual: **16,1 %** del presupuesto.
- Storage actual: **132.374.670 B**.
  - `assets`: 373 objetos, **132.272.608 B**.
  - `supplier-order-documents`: 1 objeto, **102.062 B**.
  - `automation-traces`: 0 objetos, **0 B**.
  - `knowledge`: 0 objetos, **0 B**.
- Todo el Storage ocupado corresponde al negocio `RivaTech`; los otros perfiles de negocio no tienen objetos. Por bucket, los objetos están bajo sus rutas del dueño.
- El plan Free incluye **1 GB** de Storage. Se fija un presupuesto de alerta al 90 % de **900.000.000 B**, con uso actual del **14,7 %**.
- Límites confirmados en la documentación oficial vigente: [cuotas y facturación de Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase) y [planes de Supabase](https://supabase.com/pricing). Se usa 1 GB decimal para el presupuesto de Storage; el límite de base se expresa en MiB, consistente con el valor de E1.
- La mayor tabla por tamaño total (datos e índices) es `audit_events` con **33.382.400 B**. Las 15 mayores:

| Tabla | Bytes |
|---|---:|
| `audit_events` | 33.382.400 |
| `products` | 8.667.136 |
| `inventory_product_commands` | 1.974.272 |
| `attributed_sale_commands` | 884.736 |
| `catalog_config` | 671.744 |
| `sale_items` | 638.976 |
| `sale_item_allocations` | 630.784 |
| `stock_movements` | 499.712 |
| `sales` | 499.712 |
| `cash_flow` | 491.520 |
| `cash_flow_allocations` | 483.328 |
| `inventory_holdings` | 425.984 |
| `inventory_stock_commands` | 385.024 |
| `price_list_items` | 270.336 |
| `knowledge_documents` | 270.336 |

## Negocios y cuenta administradora

Se contaron perfiles que **no** aparecen como colaborador (activo o revocado): **4**. Se midieron registros vinculados por `user_id` o `owner_uid`; no se guardaron ni mostraron UID o emails.

| Nombre de negocio | Perfil creado (UTC) | Filas vinculadas | Tiene datos | Central < 3 min | Facebook < 3 min |
|---|---|---:|---|---:|---:|
| RivaTech | 2026-04-06 19:56 | 13.317 | sí | 1 | 1 |
| leokevinr23 | 2026-04-06 20:59 | 19 | sí | 0 | 0 |
| (sin nombre) | 2026-04-29 22:03 | 16 | sí | 0 | 0 |
| (sin nombre) | 2026-08-13 20:21 | 10 | sí | 0 | 0 |

Hay **un único candidato** a administrador de plataforma por tener central y Facebook con heartbeat reciente: `RivaTech`. Los otros tres perfiles no tienen nombre de negocio y no se pudo acreditar que sean cuentas de prueba del mismo dueño. **Desvío preventivo de E1:** solo el candidato único `RivaTech` se conservará en el plan `interno`; los demás perfiles sin suscripción quedarán en `base`, que es el valor por defecto. Así no se concede acceso interno a un posible negocio externo. No se requiere intervención para este cambio y no se imprimirá ningún UID.

## Cron

`pg_cron` está instalado. Hay un job activo: `facebook-watchdog`, cada dos minutos. E2 agregará `platform-usage-daily` luego de aplicar y probar su propia migración.

## Estado de E1

- Esta línea base precede a E1; `business_subscriptions` aún no se creó.
- La migración E1 se ajustará a los límites documentados: `db_budget_bytes = 471859200` y `storage_budget_bytes = 900000000`.
- La única fila inicial de plan `interno` será para el dueño de la cuenta `RivaTech`, seleccionado de forma acotada por los dos dispositivos recientes. El alta del administrador usará el mismo criterio y verificará un único resultado sin imprimir el UID.
- El SQL de referencia se conservará intacto. El smoke E1 se ampliará para comprobar que los perfiles no verificados quedan en `base`; el desvío queda registrado en `docs/ai/STATUS.md`.
