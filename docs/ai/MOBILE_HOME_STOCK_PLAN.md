# MOBILE_HOME_STOCK_PLAN.md — Inicio y Stock pensados para el celular

**Repositorio:** `C:\Users\USER\Desktop\IA\RivaStock` · **Generado:** 04/11/2026 sobre `origin/main` = `4064b11` · **Destino:** Codex (agente ejecutor)
**Se ejecuta como:** Bloque I de `docs/ai/ACTION_PLAN.md`. Valen todas sus reglas: autorizaciones, prohibiciones, ciclo por tarea, backup verificado (`npm run backup:db`) antes de cada migración, `STATUS.md` y avisos en `docs/ai/MENSAJE_PARA_RIVA.md`.
**Pedido de Riva:** “Me gusta el rediseño. Hay que crear el plan completo, teniendo en cuenta lo que existe hoy.” Riva aprobó la maqueta.
**Orden:** después de terminar el Bloque H (H4–H9) y antes de retomar el Bloque C. Si H queda esperando una puerta del dueño, seguí con I.

---

## 0. Referencia visual (aprobada)

Las 6 pantallas aprobadas están en `docs/design/mobile-home-stock/`. Son maquetas HTML de 390×844. **No son código para copiar.** Úsalas como referencia de estructura, textos, tamaños y espaciados.

| Archivo | Pantalla | Ruta en la app |
|---|---|---|
| `Main.dc.html` | 1 · Inicio | `/` |
| `Stock.dc.html` | 2 · Lista de stock | `/stock` |
| `Filtros.dc.html` | 3 · Filtros (hoja inferior) | `/stock?filtros=1` |
| `Producto.dc.html` | 4 · Ficha del producto | `/stock?producto=<id>` |
| `AjustarStock.dc.html` | 5 · Ajustar stock (hoja inferior) | `/stock?producto=<id>&ajustar=1` |
| `NuevoProducto.dc.html` | 6 · Nuevo producto | `/stock?nuevo=1` (editar: `/stock?editar=<id>`) |

**Actualización 04/11:** para Inicio (I3) y la lista de Stock (I4), el contenido y el orden los mandan `docs/design/redesign/referencia/inicio-celular.html` y `stock-celular.html`, aprobadas después. Con los tokens actuales; el estilo nuevo lo aplica el Bloque J.

Los números y nombres de la maqueta son de ejemplo. Los hex de la maqueta son el tema oscuro: **usá los tokens existentes** (`--surface`, `--surface-raised`, `--line`, `--ink`, `--ink-muted`, `--brand`, `--action-bg`, `--danger-*`, `--success-*`, …) y respetá el tema claro. Este bloque cambia **estructura y uso**, no la identidad visual (el rediseño visual se planifica aparte).

## 1. Diagnóstico (código actual)

**Inicio — `src/pages/Dashboard.tsx` (476 líneas)**
- En el celular: título “Panel de Control”, cuatro botones a ancho completo, el panel “Titular para valoración de stock”, **9 tarjetas KPI en una sola columna**, gráficos (~520 px), ventas recientes y reposición. Lo del día (cuánto vendí, cuánta plata hay) no se ve sin scrollear, y no existe “ventas de hoy”.
- Carga tablas completas: `db.list('sales')`, `db.list('cash_flow')`, `db.list('orders')`.
- **Bug:** `DASHBOARD_PRODUCT_COLUMNS` no incluye `catalog_only`. Los productos “solo catálogo / por pedido” (stock 0) se cuentan como “Productos sin Stock” y entran en la lista de stock bajo. `Stock.tsx` sí los excluye (`!product.catalogOnly`).

**Stock — `src/pages/Stock.tsx` (1.838 líneas)**
- Encabezado con cuatro botones (Lista revendedores, Ver lista de precios, Descargar PDF, Agregar producto) que en el celular quedan apilados.
- Cuatro `select` de filtros uno debajo del otro.
- **Tabla de 9 columnas con `overflow-x-auto`: en el celular se scrollea de costado.** Cada fila tiene hasta 6 íconos de acción.
- Eliminar usa `confirm()`. Si una imagen falla, cae a `https://picsum.photos/...` (servicio externo; además puede chocar con la CSP).
- El ojo de “Mostrar en catálogo” llama a `db.update` sin `try/catch`, sin aviso y sin chequear `canWrite`. “Copiar enlace” no avisa que copió.
- El estado de los filtros vive solo en memoria. La única lectura de URL es `?status=reponer`, más `location.state.newBarcode`, que llega desde el POS cuando se escanea un código desconocido.
- El formulario de producto es un `Modal` centrado con ~20 campos seguidos (nombre, categoría, titular, stock inicial, compra, costo de proveedor, existencias por titular, venta con sugerido, mínimo, código de barras, catálogo, descripción pública, imágenes, observaciones, permitir en pruebas automáticas). En el celular el teclado tapa el botón de guardar.
- Hay tres flujos especiales que **no se pueden romper**: producto solo para revendedores (`creatingProductForReseller`), pasar un producto de catálogo a stock (`promotingCatalogProduct`) y volver a la lista de revendedores (`returnToResellerList`). También la idempotencia (`productIntentRef`, `beginSubmission`), el chequeo de nombre duplicado y la limpieza de imágenes pendientes.

**Movimientos de stock**
- Con **titulares activados** existe `mutate_inventory_holding_stock(product, owner, delta, reason, idempotency_key)`, que registra en `inventory_stock_commands`. El historial lo lee con `list_inventory_movements`, clasificado por `inventory_movements_view`.
- Con **titulares desactivados** (lo normal en una cuenta nueva, como la del primer cliente), cambiar el stock es un `db.update` directo sobre `products.stock`. **No queda movimiento, motivo ni autor.** `mutate_inventory_holding_stock` rechaza esa situación (“La operación por titulares todavía no está habilitada”).
- La vista clasifica por texto del motivo: `'Ingreso de mercadería'` → ingreso; sufijos `(transferencia saliente|entrante)` → transferencia; `'Edición de producto y existencias'` → edición; el resto → ajuste.

**Otros**
- La barra inferior (`Layout.tsx`) muestra los primeros 5 ítems permitidos de `NAV_ITEMS`. Hoy son Inicio, Consulta rápida, Stock, Buscar y enviar y Ventas, lo mismo que la maqueta. `useMobileAppChrome` (de H2) ya oculta encabezado y barra.
- El POS (`/pos`) y Buscar y enviar (`/fotos`) no aceptan un producto preseleccionado por URL.
- En H3 ya existen hojas inferiores con foco atrapado (`MobileAIChatList.tsx`, `MobileAIHubNavigation.tsx`), pero dentro de `components/ai/`.

## 2. Principios

1. **Solo cambia el celular.** Debajo de `lg` (1024 px) aplica el diseño nuevo. **Desde `lg` la PC queda igual que hoy**: captura de Playwright a 1280 px de `/` y `/stock` antes y después; la diferencia tiene que ser nula o estar explicada. La única excepción permitida en PC son los arreglos de la sección 1 marcados como bug (catálogo, picsum, errores del ojo), que también se aplican ahí.
2. **Una pantalla por vez con estado en la URL** (tabla de la sección 0), para que funcionen el botón atrás de Android, el gesto de iPhone y los links directos. Abrir hace `push`; volver hace `history.back()` si la entrada anterior es de la app y, si no, `replace` a `/stock`. Los filtros también van en la URL (`/stock?q=…&cat=…&estado=…&titular=…&orden=…&catalogo=1`) con `replace`, y al volver de la ficha se recupera la posición del scroll.
3. **No duplicar lógica de negocio.** El guardado de producto (`handleSave`, idempotencia, revendedores, promoción, titulares) se reutiliza tal cual. Lo que cambia es la presentación. Sacá piezas de `Stock.tsx` a componentes o hooks en `src/components/stock/` y `src/hooks/` cuando haga falta; no copies código.
4. **Permisos y plan iguales que hoy:** `usePermission('stock', 'write' | 'delete')`, `useBusinessWriteAccess` (cuenta suspendida = solo lectura, sin botones de escritura), módulos del plan (Publicar en Facebook solo con `automation`). Un colaborador con stock de solo lectura ve la ficha sin “Ajustar”, “Editar” ni “Eliminar”.
5. **Táctil y accesible:** objetivos de 44 px o más, `<button>`/`<a>` reales, `aria-label` en los botones con solo ícono, hojas inferiores con foco atrapado y cierre con `Esc` y deslizando, contraste AA en los dos temas, y estados que no dependen solo del color (por ejemplo “Sin stock” con texto). `inputmode="decimal"` en precios y `inputmode="numeric"` en cantidades.
6. **Rendimiento:** los componentes móviles en chunks `lazy`, sin pasar los presupuestos de `perf:check`. El celular no debe bajar más datos que hoy.

## 3. Tareas

### [ ] I1 Piezas compartidas
- Llevá la hoja inferior de H a `src/components/mobile/BottomSheet.tsx` (con título, foco atrapado, `Esc`, deslizar, `safe-area-inset-bottom`) y usala desde IA, sin cambiar su comportamiento.
- Agregá `useIsMobile()` en `src/hooks/` con la misma media query que `useMobileAppChrome` (`max-width: 1023px`) y reutilizala en los dos.
- Agregá `src/components/stock/StockBadge.tsx`: “Sin stock” (peligro), “Quedan N” (atención, cuando `0 < stock <= minStock`) o nada.
- Agregá `src/lib/stockStatus.ts` con `getStockStatus(stock, minStock)`, de un solo criterio para todo el bloque: `out` si stock = 0; `low` si `0 < stock <= minStock`; `ok` en el resto.
- Arreglos en las dos vistas:
  - quitá el fallback a `picsum.photos` y mostrá el ícono local;
  - el ojo de catálogo con `try/catch`, aviso, chequeo de `canWrite` y actualización optimista con vuelta atrás si falla;
  - “Copiar enlace” avisa “Enlace copiado”.
- Tests de `getStockStatus` y de la hoja inferior (foco y `Esc`).
- **Commit:** `feat(mobile): shared mobile primitives for stock`

### [ ] I2 Resumen del Inicio (datos)
- Pasá los cálculos de `Dashboard.tsx` a `src/lib/dashboardSummary.ts`, como funciones puras con tests:
  - **Hoy:** ventas de hoy (suma de `total` y cantidad de ventas con fecha local de hoy, todos los estados), efectivo disponible y cobros pendientes (mismo cálculo que hoy);
  - **Mes:** ventas del mes, balance neto, transferencias disponibles, valor en stock, total invertido y ganancia potencial (sin cambiar las fórmulas);
  - **Alertas:** cantidad sin stock y con stock bajo según `getStockStatus`.
- Agregá `catalog_only` a `DASHBOARD_PRODUCT_COLUMNS` y excluí esos productos de los conteos y de “Reposición sugerida”. Es el bug de la sección 1; aplica también en PC. Agregá un test que lo cubra.
- “Hoy” usa la zona horaria del navegador (Argentina). Testeá el borde de medianoche.
- Sin cambios de consultas en esta tarea. Si querés achicar lo que baja el Inicio (columnas o rango de fechas), hacelo como mejora aparte, con números de antes y después en `STATUS.md` y sin cambiar los resultados.
- **Commit:** `refactor(dashboard): extract dashboard summary`

### [ ] I3 Inicio en el celular (pantalla 1)
- Debajo de `lg`, `Dashboard.tsx` renderiza `MobileHome` (lazy). La versión de PC queda igual.
- Arriba, la fecha (“Miércoles 4 de noviembre”) y “Hola, {nombre}” (primer nombre del perfil, o el nombre del negocio).
- Tarjeta **Hoy**:
  - ventas de hoy grande, con la cantidad de ventas;
  - efectivo disponible y cobros pendientes en dos columnas;
  - el link “Ver caja” va a `/caja`.
  - Cada dato se muestra solo si el usuario tiene permiso de leer ese módulo (ventas, caja).
- **Una sola alerta:** “N sin stock y M con stock bajo”. “Ver” abre `/stock?estado=reponer`. Si no hay nada que avisar, no se muestra.
- **Accesos rápidos:** grilla de 4×2.
  - Lista: Vender (`/pos`), Consultar precio (`/consulta-rapida`), Enviar fotos (`/fotos`), Cargar ingreso (`/ingresos`), Presupuesto (`/presupuestos`), Clientes (`/clientes`), Caja (`/caja`), Pedidos (`/pedidos`).
  - Se filtran con la misma regla de permisos y plan que `NAV_ITEMS`. Si quedan menos, la grilla se acomoda sin huecos.
- **Tira del mes** (“Noviembre”, con link “Reportes” a `/reportes`): tarjetas que se deslizan de costado, con `scroll-snap`. Van ventas del mes, balance neto, valor en stock, transferencias, total invertido y ganancia potencial.
  - Si hay más de un titular visible, el selector de titular de la valoración pasa a ser un chip en esa tira, que abre una hoja con los titulares. Si hay uno solo, no se muestra.
- Abajo, colapsados: “Gráficos” (monta `DashboardCharts` recién al abrir), “Ventas recientes” y “Reposición sugerida”.
  - “Exportar reporte PDF” va en un menú “⋯” del encabezado.
  - “Plataforma” se muestra solo a los admins de plataforma.
- `PlatformDashboardNotices` sigue apareciendo arriba de todo cuando corresponde.
- Estados: esqueletos al cargar; si falla una fuente (ventas, caja o pedidos), la tarjeta muestra “No se pudo cargar” con reintento y el resto sigue andando. Una cuenta vacía muestra la bienvenida que ya existe.
- **Commit:** `feat(dashboard): mobile home`

### [ ] I4 Lista de stock (pantallas 2 y 3)
- Debajo de `lg`, la tabla se reemplaza por **filas compactas** (`MobileStockList`, lazy), de 72 px o más.
  - Cada fila tiene miniatura (primera imagen o ícono), nombre en una línea, categoría, precio de venta y `StockBadge`.
  - Con titulares activados, la fila suma una línea chica con el reparto (“Riva 4 · Juan 3”).
  - Tocar la fila abre la ficha.
- **Encabezado:** “Stock · N productos” y un menú “⋯” con lo que hoy son botones:
  - Lista revendedores;
  - Ver lista de precios y Descargar PDF;
  - Generar códigos (entra en modo selección, con barra “N seleccionados · Generar códigos · Cancelar”);
  - Historial de movimientos.
- **Buscador** con espera de 150 ms, sin acentos ni mayúsculas. Busca por nombre, código de barras y titular (hoy no busca por código).
  - El **botón de escanear** usa `BarcodeScannerOverlay`. Si encuentra el producto, abre su ficha. Si no, pregunta “¿Crear producto con este código?” y abre Nuevo producto con el código cargado (mismo flujo que hoy `newBarcode`).
- **Chips:** Filtros (con contador de filtros activos), Categoría, “Sin stock · N” y “Stock bajo · N”. Los conteos se calculan sobre los productos visibles.
  - El estado “Reposición sugerida” de hoy se mantiene en la hoja de filtros, y `?status=reponer` sigue funcionando.
- **Hoja de filtros:** Categoría (chips), Estado (Todos, Con stock, Sin stock, Stock bajo, Reposición sugerida), Titular (si hay titulares), Ordenar (Nombre A–Z, Menos stock primero, Precio mayor, Precio menor, Recientes) y “Solo en catálogo”. Botones “Limpiar” y “Ver N productos”. Todo va en la URL (principio 2).
- **Paginación:** 30 filas y “Ver más (N)” al final, con el mismo `filteredProducts`. Sin paginación por número en el celular.
- **Botón flotante** “Agregar producto” arriba de la barra inferior, solo con permiso de escritura y cuenta activa.
- Avisos que hoy están arriba de la tabla (limpieza de imágenes pendiente, “Stock compartido por titular”, reposición): en el celular, una sola franja que se puede cerrar por sesión, y “Reposición” se ve como chip.
- Estados vacíos: “Todavía no cargaste productos” con botón; “No hay productos con esos filtros” con “Limpiar filtros”.
- **Commit:** `feat(stock): mobile product list and filters`

### [ ] I5 Ficha del producto (pantalla 4)
- `/stock?producto=<id>` abre `MobileProductDetail` a pantalla completa (sin barra inferior ni encabezado, con `useMobileAppChrome`).
  - Un id inexistente o de otro negocio muestra “No encontramos ese producto” y “Volver al stock”.
  - En PC, ese mismo link abre el editor de hoy.
- **Fotos** grandes, deslizables, con indicador “1 / N”. Tocar abre la imagen completa. Encima van atrás y “⋯”.
- **Datos:**
  - nombre, categoría y código de barras (o “Sin código”);
  - tarjeta de precio: venta grande, compra y margen. Usá la misma economía de `getVisibleHoldingEconomics` que la tabla y mostrá el rango si hay costos mezclados;
  - tarjeta de stock: unidades, `StockBadge` y “Ajustar stock”. Con titulares, una línea por titular.
- **Acciones grandes:**
  - **Vender** abre `/pos?producto=<id>`: el POS agrega ese producto al carrito una vez y limpia el parámetro con `replace`;
  - **Enviar fotos** abre `/fotos?producto=<id>`: Buscar y enviar abre directo ese producto;
  - **Editar** abre `/stock?editar=<id>`.
  - Si el producto no tiene stock, Vender queda deshabilitado con el texto “Sin stock”.
- “Mostrar en catálogo” como interruptor (con el arreglo de I1).
- **Secciones colapsables:**
  - Código de barras: Imprimir etiqueta, o Generar e imprimir si no tiene. Reutilizá `generateAndPrint` y `BarcodePrintModal`.
  - Precios para revendedores: abre la lista de revendedores enfocada en el producto, si esa función ya existe. Si no, solo el link a la lista.
  - Movimientos: `MovementHistoryPanel` filtrado por `productId`, con los últimos 10 y “Ver todos”.
  - Descripción y observaciones, solo lectura.
- **Menú “⋯”:**
  - Copiar enlace del catálogo y Compartir (Web Share, si hay `catalogSlug` y el producto está en catálogo);
  - Publicar en Facebook (solo con módulo `automation`, abre `FacebookPublicationModal` como hoy);
  - **Eliminar**, solo con `canDelete`. Confirma en una hoja inferior propia (“Se borra el producto y sus fotos. No se puede deshacer.”) y usa el mismo `handleDelete`. Reemplazá también `confirm()` en PC por un modal propio.
- **Commit:** `feat(stock): mobile product detail`

### [ ] I6 Ajustar stock con motivo (pantalla 5): base de datos
**Requiere backup verificado antes de migrar.**

Migración aditiva `adjust_product_stock`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`. Firma:

```
adjust_product_stock(
  p_product_id uuid,
  p_inventory_owner_id uuid,   -- NULL si no hay titulares
  p_mode text,                 -- 'add' | 'remove' | 'count'
  p_quantity integer,          -- add/remove: > 0; count: >= 0 (cantidad contada)
  p_reason text,               -- 1 a 300 caracteres
  p_idempotency_key text
) RETURNS inventory_stock_commands  -- NULL si count no cambia nada
```

Reglas de la función:
- **Permisos:** exige `auth.uid()` y `has_permission(auth.uid(), 'stock', 'write')`. El producto tiene que ser del negocio (`get_owner_uid`) y no `catalog_only`. El bloqueo de cuenta suspendida tiene que aplicar: verificá que los triggers de `20261103225950_platform_suspension_write_guards.sql` cubran `products`, `inventory_holdings` e `inventory_stock_commands`; si `inventory_stock_commands` no está, agregalo en esta migración.
- **Idempotencia** igual que `mutate_inventory_holding_stock`: `pg_advisory_xact_lock` y repetición segura. Si la clave ya se usó con otros datos, error.
- **Sin titulares** (`holdings_enabled = false`):
  - bloquear la fila de `products` (`FOR UPDATE`);
  - calcular el delta (`count`: contado − actual);
  - actualizar `products.stock`, lo que deja al trigger existente sincronizar `inventory_holdings`;
  - insertar el comando con `inventory_owner_id` y su nombre tomados del producto.
- **Con titulares:** exige `p_inventory_owner_id` y aplica las mismas validaciones de membresía, titular activo y existencia activa que `mutate_inventory_holding_stock`. Reutilizá esa función o su lógica, y no la cambies.
- **Límites:**
  - nunca se baja de 0. El error dice “Stock insuficiente. Hay N unidades.”;
  - si `count` coincide con el stock actual, no se escribe nada y se devuelve `NULL`;
  - el motivo se guarda como `Ajuste manual · <motivo>`. Así no choca con los textos que la vista clasifica como ingreso, transferencia o edición, y aparece como “Ajuste” en el historial.
- `REVOKE ALL … FROM PUBLIC, anon` y `GRANT EXECUTE … TO authenticated`.

Pruebas y cierre:
- Tests PGlite en `docs/ai/` (como `multi-business-sql-smoke.mjs`). Cubren los dos modos (con y sin titulares), add, remove y count, el límite en 0, la idempotencia, el permiso de solo lectura, otro negocio, un producto `catalog_only` y la cuenta suspendida.
- En producción, solo smoke dentro de una transacción con `ROLLBACK`, como en F2b. **No ajustes stock real.**
- `src/lib/stockAdjustments.ts` con `adjustProductStock()`, tipado y con mensajes en castellano.
- **Commit:** `feat(stock): stock adjustments with reason`

### [ ] I7 Ajustar stock: hoja inferior
- Se abre desde la ficha (y desde “⋯” → Ajustar en una fila larga si querés), con `&ajustar=1`.
- Elementos de la hoja:
  - selector segmentado **Sumar | Restar | Contar**, con Sumar por defecto. “Contar” cambia el texto a “¿Cuántas unidades contaste?”;
  - paso a paso − / número / +, con el número editable (`inputmode="numeric"`);
  - vista previa siempre visible: “Va a quedar en N unidades”. En rojo, y con el botón deshabilitado, si quedaría por debajo de 0;
  - motivo con chips: Ingresó mercadería, Rotura, Pérdida o robo, Devolución, Conteo, Uso interno y Otro. “Otro” abre un campo de texto obligatorio. En Contar, el motivo por defecto es Conteo;
  - con titulares y más de uno operable, un selector de titular (el principal por defecto).
- **Guardar ajuste:**
  - usa una clave de idempotencia por intento (`resolveIdempotencyIntent`) y doble toque bloqueado (`beginSubmission`);
  - al terminar actualiza la ficha y la lista sin recargar todo, muestra “Stock actualizado: N unidades” y cierra la hoja.
- “Ingresó mercadería” es un ajuste rápido. La pantalla de Ingresos sigue siendo el camino completo, con proveedor y costo. Mostrá abajo el link “¿Compra con proveedor? Cargá un ingreso”.
- **Edición de producto existente en el celular:** el campo stock queda de solo lectura con “Ajustar” al lado, para que todo cambio de stock deje motivo. En PC, el editor queda como hoy.
- **Commit:** `feat(stock): mobile stock adjustment sheet`

### [ ] I8 Nuevo y editar producto (pantalla 6)
- `/stock?nuevo=1` y `/stock?editar=<id>` abren `MobileProductForm` a pantalla completa debajo de `lg`. En PC sigue el `Modal` de hoy.
  - Para no duplicar, sacá el estado del formulario y `handleSave`/`closeProductEditor` a un hook (`useProductEditor`), y los campos a componentes que usen los dos contenedores.
  - Los flujos de revendedor, promoción y `returnToResellerList` siguen igual en las dos vistas.
- **Orden de los campos:**
  1. fotos: “Sacar foto” (`<input type="file" accept="image/*" capture="environment">`) y “Galería”, con el mismo `ImageUpload`, la misma optimización y los mismos límites. Miniaturas reordenables y con quitar;
  2. Nombre;
  3. Categoría y Código de barras (con botón de escanear) en dos columnas;
  4. Precio de compra y Precio de venta, en dos columnas, con margen en vivo (“Margen 79 %”) y el sugerido por rangos que ya existe, que se puede tocar para usarlo;
  5. Stock inicial y “Avisarme con” (stock mínimo). Con titulares va la sección “Existencias por titular” de hoy. Al editar, el stock es de solo lectura (I7);
  6. **“Más opciones”** colapsable: Mostrar en catálogo, Descripción pública, Titular, Observaciones, Campos propios y “Permitir en pruebas automáticas”, que solo aparece donde aparece hoy.
- Botón **“Guardar producto”** fijo abajo, que queda visible con el teclado abierto (`100dvh` / `visualViewport`). Errores junto al campo y el foco va al primero.
- **Cambios sin guardar:** si se cierra con cambios, una hoja “¿Descartar los cambios?” (Seguir editando / Descartar). Lo mismo con el botón atrás.
- Al crear, se abre la ficha del producto nuevo. Al editar, se vuelve a la ficha.
- **Commit:** `feat(stock): mobile product form`

### [ ] I9 Cierre: pruebas y verificación en producción
- **Playwright** con viewport Android (390×844, Chromium) e iPhone (390×844, WebKit), más una pantalla chica de 360×740:
  - Inicio: Hoy, alerta, accesos filtrados por permisos y tira del mes;
  - Stock: buscar (también por código), chips, filtros en la URL, atrás desde la ficha conserva filtros y scroll, y “Ver más”;
  - ficha: Vender lleva al POS con el producto y Enviar fotos a ese producto;
  - ajustar: sumar, restar, contar y el error por debajo de 0;
  - nuevo producto: crear, editar y descartar cambios; los flujos de revendedor y promoción siguen andando;
  - barra inferior oculta en las pantallas completas.
- **Roles:**
  - colaborador con stock de solo lectura: sin botones de escritura;
  - cuenta suspendida: solo lectura;
  - plan sin `automation`: sin Publicar en Facebook;
  - cuenta con titulares y cuenta sin titulares.
- **PC sin cambios:** capturas a 1280 px de `/` y `/stock` antes y después. Solo pueden cambiar los arreglos de bug de la sección 1.
- Accesibilidad: foco y `Esc` en las hojas, `aria-label`, contraste AA en claro y oscuro.
- `npm run lint`, `npm test`, `npm run build` y `npm run perf:check`.
- **Producción:**
  - con el perfil persistente de Playwright en viewport móvil, recorré todo con un producto `[QA] Producto de prueba` creado desde la app: ajustalo, editalo y borralo desde la app al final;
  - no toques productos reales;
  - capturas en `docs/design/mobile-home-stock/production/`, sin datos personales ni montos reales (tapalos).
- Avisá en `MENSAJE_PARA_RIVA.md`: “El Inicio y el Stock del celular ya tienen el diseño nuevo”, con qué probar (buscar un producto, abrir la ficha, ajustar stock con motivo y cargar uno nuevo sacando una foto).
- **Commit:** `docs(stock): record mobile home and stock rollout`

## 4. Fuera de alcance
- Rediseño visual (colores, tipografías, identidad), temas de temporada y cambios en la versión de PC fuera de los bugs de la sección 1.
- POS, Ventas, Ingresos, Caja y demás pantallas (se maquetan aparte).
- Cambios en precios, fórmulas de KPIs, permisos, titulares o en el publicador de Facebook.
- Nuevas dependencias de UI: usá lo que ya está (`lucide-react`, `motion`, Tailwind).
