# REDESIGN_PLAN.md — Rediseño completo de RivaStock con Impeccable

**Repositorio:** `C:\Users\USER\Desktop\IA\RivaStock` · **Generado:** 04/11/2026 · **Destino:** Claude Code, con la skill Impeccable
**Se ejecuta como:** Bloque J de `docs/ai/ACTION_PLAN.md`. Valen sus reglas permanentes (sección 1): prohibiciones, un commit por tarea, `STATUS.md` y avisos en `docs/ai/MENSAJE_PARA_RIVA.md`. En `STATUS.md`, marcá tus entradas con `[Claude Code]`.
**Pedido de Riva:** “Ahora sí me gusta bastante más” (Inicio y Stock minimalistas). Quiere terminar todo el rediseño con Claude Code y la skill Impeccable.

---

## 0. Fuentes de verdad

| Archivo | Qué manda |
|---|---|
| `PRODUCT.md` (raíz) | Producto, usuarios y principios (ficha de Impeccable) |
| `DESIGN.md` (raíz) | Colores claro/oscuro, tipografía, espacios, componentes, reglas |
| `docs/design/redesign/referencia/*.html` | Pantallas aprobadas: `inicio-pc`, `stock-pc`, `inicio-celular`, `stock-celular`. Se abren en el navegador y tienen un botón para cambiar claro/oscuro. Los datos son de ejemplo. |
| `docs/design/mobile-ai/`, `docs/design/mobile-home-stock/` | **Estructura** ya aprobada (Chat IA, Tareas, ficha, ajustar stock, nuevo producto). Se mantiene la estructura y se aplica el estilo de `DESIGN.md`. |

Si algo choca, el orden de prioridad es: lo que diga Riva, después `DESIGN.md`, después las referencias y por último el código actual.

## 1. Convivencia con Codex (obligatorio)

Codex está trabajando en el mismo repositorio (Bloques H e I, que tocan `AIHub`, `Dashboard`, `Stock` y `Layout`). Para no pisarse:

- **Fases J0 y J1 (se pueden hacer ya):** solo tocan `PRODUCT.md`, `DESIGN.md`, `docs/design/redesign/**`, `.claude/**` y la configuración de Impeccable. **No toques `src/`, `supabase/` ni `extensions/`.**
- **Fase J2 (implementación):** arranca solo cuando se cumplan las tres condiciones:
  - H9 e I9 están marcados `[x]` en `docs/ai/ACTION_PLAN.md` de `origin/main`;
  - Codex no tiene commits en curso: el último commit de Codex tiene más de 30 minutos y `docs/ai/STATUS.md` no dice que haya una tarea en progreso;
  - Riva lo confirma en el chat.

  Si no se cumplen, dejá J2 esperando, avisá en `MENSAJE_PARA_RIVA.md` y seguí con J1.
- **Trabajá en tu propio worktree, igual que Codex.** La carpeta del Escritorio está en una rama vieja (`feat/conocimientos`) y tiene cambios sin commitear que no son tuyos: no la uses para trabajar ni hagas `checkout`, `reset` o `stash` ahí. Creá el worktree una sola vez:
  `git fetch origin && git worktree add C:\Users\USER\.claude\worktrees\redesign -b claude/redesign origin/main`
  Copiá desde la carpeta del Escritorio a tu worktree `PRODUCT.md`, `DESIGN.md`, `docs/ai/REDESIGN_PLAN.md` y `docs/design/redesign/referencia/` (Riva los dejó ahí sin commitear).
- **Antes de cada tarea:** `git fetch` y `git rebase origin/main`. **Para entregar:** `git push origin HEAD:main` (avance rápido). Si `main` avanzó, rebase y repetí. Un commit por tarea. Nunca `--force`.

## 2. Reglas del rediseño

1. **No se pierde ninguna función.** Antes de rediseñar una pantalla, leé su código y hacé un inventario: botones, filtros, columnas, modales, estados vacíos y de error, permisos y módulos del plan. El boceto y la implementación los tienen que incluir todos. Ese inventario va en el boceto como comentario HTML.
2. **Solo cambia la presentación.** No se tocan la lógica, las consultas, las RPC, los permisos, la idempotencia ni los flujos especiales (revendedores, titulares, promoción de catálogo, publicador). Si un cambio de estructura necesita lógica nueva, va como tarea aparte y con Riva al tanto.
3. **Tokens, no colores sueltos.** Todo color sale de las variables CSS de `src/index.css`, definidas para `:root` (claro) y `.dark` (oscuro) según `DESIGN.md`. Hay que eliminar los `slate-*`, `indigo-*`, `emerald-*`, `#365fad` y el crema que estén sueltos.
4. **Claro y oscuro** son de primera clase. Hay que verificar los dos en cada pantalla.
5. **PC y celular:** debajo de 1024 px vale la estructura móvil (H, I y las referencias); desde 1024 px, la de PC.
6. **Accesibilidad:** contraste AA, objetivos de 44 px en el celular, foco visible y `aria-label` en los botones con solo ícono.
7. **Rendimiento:** sin dependencias nuevas, salvo la fuente si decidís alojarla en el proyecto. Respetá `perf:check`.
8. **Datos reales:** nunca cambies ni borres datos de negocios reales. Las capturas de producción tapan montos y nombres reales.

## 3. Tareas

### [ ] J0 Instalar Impeccable y preparar el contexto
- En la raíz del repo: `npx impeccable install --providers=claude --scope=project`. Aceptá el hook de diseño. Recargá Claude Code y verificá con `/impeccable doctor`.
- Revisá los hooks que dejó el instalador en `.claude/` antes de seguir.
- `PRODUCT.md` y `DESIGN.md` ya están en la raíz. **No corras `init` ni `document` encima.** Si `doctor` pide ajustes de formato, hacé solo esos.
- **Línea base:**
  - `npx impeccable detect --json src/ > docs/design/redesign/baseline-detect.json`;
  - con la app corriendo (`npm run dev`), `npx impeccable detect http://localhost:<puerto>/login`;
  - resumen corto en `docs/design/redesign/BASELINE.md`: cantidad de hallazgos por regla y las 10 pantallas más afectadas.
- Agregá `.impeccable/config.local.json` y cualquier caché local de Impeccable al `.gitignore`, si no están.
- **Commit:** `chore(design): install impeccable and design context`

### [ ] J1 Bocetos por tandas (solo HTML, sin tocar `src/`)
Usá `/impeccable shape` para cada pantalla y seguí `DESIGN.md`, las referencias y el inventario del punto 2.1. El resultado es un HTML por pantalla en `docs/design/redesign/<tanda>/<pantalla>-pc.html` y `<pantalla>-celular.html`, con el mismo esqueleto que las referencias: tokens claro/oscuro, botón para cambiar de tema, Hanken Grotesk y datos de ejemplo verosímiles en pesos.

Después de cada tanda:
- corré `npx impeccable detect` sobre los HTML y corregí lo que marque;
- `/impeccable critique` de la tanda, con las notas en `docs/design/redesign/<tanda>/CRITIQUE.md`;
- capturas con Playwright: 1440 px para PC y 390×844 para el celular, en claro y en oscuro, guardadas en `docs/design/redesign/<tanda>/capturas/`;
- un índice `docs/design/redesign/index.html` con links a todas las pantallas (se actualiza en cada tanda);
- aviso en `MENSAJE_PARA_RIVA.md`: “Tanda N lista para revisar: abrí docs/design/redesign/index.html”. **Esperá la aprobación de Riva antes de implementar esa tanda.** Mientras tanto, podés seguir con la tanda siguiente.

Tandas, en este orden:
1. **Mostrador:** Ventas (lista y detalle), POS, Consulta rápida y Buscar y enviar.
2. **Plata y clientes:** Flujo de caja, Ingresos, Clientes y Presupuestos (incluido el presupuesto público `/presupuesto/:id`).
3. **Cara hacia afuera:** Catálogo público y su ficha de producto, Login, Recuperar contraseña, Restablecer contraseña y Bienvenida. El catálogo es la cara del comercio y no de RivaStock: dejá espacio para temas de temporada (Navidad, Día de la Madre, etc.) sin diseñarlos todavía.
4. **Gestión:** Proveedores, Compras a proveedores, Pedidos, Reportes, Calculadora, Configuración (todas sus pestañas), Trazabilidad y Plataforma.
5. **IA:** Chat, Tareas, Conocimientos y Automatizaciones, respetando la estructura de `docs/design/mobile-ai/`.
6. **Piezas comunes:** modales y hojas inferiores, menú lateral y menú móvil completo, avisos (toasts), estados vacíos, de carga y de error, y los formularios de producto, de ajuste de stock y de nuevo producto (`docs/design/mobile-home-stock/`).

**Commit por tanda:** `docs(design): redesign mockups batch N`

### [ ] J2 Implementación (solo cuando se cumpla la condición del punto 1)
**J2.0 Base (una sola vez, antes de cualquier pantalla):**
- `src/index.css`: los tokens de `DESIGN.md` para claro y oscuro, conservando los nombres de variables que ya existen (`--surface`, `--ink`, `--line`, `--brand`, …). Las nuevas se agregan, los valores viejos se reemplazan. Hanken Grotesk reemplaza a Inter Tight.
- `index.html` y `public/manifest.json`: `theme-color` y favicon nuevos, sin índigo.
- Componentes compartidos en `src/components/ui/`:
  - `Money` (signo `$` chico y en gris);
  - `Button`, con las variantes primary, accent, secondary y ghost;
  - `Chip`, `Segmented`, `Switch`, `ListRow`, `QuickTile`, `Notice`, `SearchField` y `Menu` (el “⋯”);
  - la `BottomSheet` que ya existe de H.
  
  Reutilizá lo que ya exista antes de crear algo nuevo.
- Capturas antes y después de 5 pantallas al azar, para confirmar que la base no rompe nada.
- **Commit:** `feat(design): new design tokens and ui primitives`

**J2.1 en adelante, una tarea por pantalla aprobada, en el orden de las tandas.** Empezá por Inicio y Stock, que ya están aprobados y tienen referencia. En cada pantalla:
1. Implementar el boceto aprobado en PC y celular, en claro y oscuro, usando los componentes de `ui/`.
2. Revisar que el inventario esté completo, con permisos de solo lectura, cuenta suspendida y plan sin IA.
3. Correr `npx impeccable detect` sobre los archivos tocados y sobre la URL local de la pantalla, `/impeccable audit` y después `/impeccable polish`.
4. Correr `npm run lint`, `npm test`, `npm run build` y `npm run perf:check`.
5. Sacar capturas en los dos temas y los dos tamaños, y compararlas con el boceto.
6. Hacer el commit: `feat(design): redesign <pantalla>`.

### [ ] J3 Cierre
- `npx impeccable detect src/` y `npx impeccable detect` sobre la app local: comparar con la línea base de J0. La meta es cero hallazgos sin explicación.
- `/impeccable critique` general del recorrido completo: vender, consultar un precio, mandar fotos, cargar un ingreso y armar un presupuesto.
- Actualizá `DESIGN.md` solo si cambió algo durante la implementación (con `/impeccable document`).
- Despliegue según `DEPLOY_CHECKLIST.md`. Revisá producción en el celular con el perfil de QA, con capturas en `docs/design/redesign/produccion/` y los datos sensibles tapados.
- Aviso a Riva en `MENSAJE_PARA_RIVA.md` con qué probar.
- **Commit:** `docs(design): record full redesign rollout`

## 4. Fuera de alcance
- Cambiar funciones, textos legales, precios, permisos o la lógica del publicador.
- Los temas de temporada del catálogo y el módulo Diseñador (se planifican aparte, sobre este sistema).
- Cambios en la extensión de Chrome.
