# MOBILE_AI_UX_PLAN.md — Chat IA y Tareas pensados para el celular

**Repositorio:** `C:\Users\USER\Desktop\IA\RivaStock` · **Generado:** 03/11/2026 · **Destino:** Codex (agente ejecutor)
**Se ejecuta como:** Bloque H de `docs/ai/ACTION_PLAN.md`. Valen todas sus reglas: autorizaciones, prohibiciones, ciclo por tarea, backup antes de cada migración, `STATUS.md` y avisos en `docs/ai/MENSAJE_PARA_RIVA.md`.
**Pedido de Riva:** “El diseño del Chat IA es horrible en el celular. Las tareas lo mismo, tengo un chorizo de tareas… o de chats.” Riva aprobó la maqueta.

---

## 0. Referencia visual (aprobada)

Las 6 pantallas aprobadas están en `docs/design/mobile-ai/`. Son archivos HTML de maqueta, de 390×844 cada uno. **No son código para copiar.** Úsalos como referencia exacta de estructura, textos, tamaños, espaciados y colores.

| Archivo | Pantalla |
|---|---|
| `Main.dc.html` | 1 · Lista de chats |
| `Conversacion.dc.html` | 2 · Conversación |
| `AjustesChat.dc.html` | 3 · Ajustes del chat (hoja inferior) |
| `Tareas.dc.html` | 4 · Lista de tareas |
| `TareaDetalle.dc.html` | 5 · Detalle de tarea |
| `NuevaTarea.dc.html` | 6 · Nueva tarea |

Los colores de la maqueta son los del tema oscuro actual. **Usá los tokens existentes de la app** (`--surface`, `--line`, `--ink`, `--ink-muted`, `--brand`, `--action-bg`, …), no los hex de la maqueta, y respetá también el tema claro. Este bloque cambia **la estructura y el uso**, no la identidad visual: el rediseño visual se planifica aparte.

## 1. Diagnóstico (código actual)

- `src/components/AIChats.tsx`: una grilla de tres columnas (lista · conversación · ajustes) que solo se separa desde `lg`. En el celular las tres se **apilan**: primero la lista entera de chats, después la conversación y al final los ajustes de modelo y razonamiento.
- `src/pages/AIHub.tsx`, vista Tareas: el mismo problema con `xl:grid-cols-[17rem_minmax(0,1fr)_18rem]`. Lista, formulario y detalle quedan apilados, y la lista muestra todas las tareas.
- Siete pestañas en una fila (Chats, Tareas, Acciones, Skills, Memoria, Conexión, Conocimientos).
- Cada mensaje es una tarjeta con encabezado “Agente · fecha”. Las fuentes son chips grandes. El `textarea` tiene `rows={3}` y contador fijo.
- La barra inferior de la app (`Layout.tsx`) ocupa lugar durante la conversación.
- Borrar un chat pasa por “⋯” y `window.confirm`.

## 2. Principios

1. **Solo cambia el celular.** Debajo de `lg` (1024 px) aplica el diseño nuevo. **Desde `lg` la PC queda exactamente como hoy**: verificalo con una captura de Playwright antes y después.
2. **Una pantalla por vez**, con estado en la URL, para que funcionen el botón atrás de Android, el gesto de iPhone y los links directos:
   - `/ia?view=chats` lista · `/ia?view=chats&chat=<id>` conversación · `/ia?view=chats&chat=new` chat nuevo;
   - `/ia?view=tasks` lista · `/ia?view=tasks&task=<id>` detalle · `/ia?view=tasks&new=1` nueva tarea;
   - abrir algo hace `push`; volver hace `history.back()` si la entrada anterior es de la app y, si no, `replace` a la lista.
3. **Pantalla completa** en conversación, detalle y nueva tarea: se ocultan la barra inferior y el encabezado de la app.
4. **Nada de lógica nueva de IA.** Se reutilizan `getAIChats`, `getAIChat`, `sendAIChatMessage`, `deleteAIChat`, `getRecentAIJobs`, `createAIJob`, `deleteAITask`, etc. Solo se agrega lo que falta para la vista previa y la paginación (H1).
5. **Accesible y táctil:** objetivos de 44 px o más, `<button>`/`<a>` reales, `aria-label` en los botones con solo ícono, foco atrapado en las hojas inferiores con cierre por `Esc` y por deslizar, contraste AA en los dos temas, y estados que no dependen solo del color (ícono + texto).
6. **Rendimiento:** los componentes móviles en chunks `lazy`, sin pasar los presupuestos de `perf:check`. Si hace falta ajustar un presupuesto, justificalo con números.

## 3. Tareas

### [x] H1 Datos para la lista
- **Migración aditiva:** `ai_chats.last_message_preview text` (hasta 140 caracteres, sin saltos de línea ni markdown), mantenida por un trigger en `ai_chat_messages` al insertar, y rellenada una vez para los chats existentes. Mismo RLS. Sin datos sensibles nuevos: es un recorte del propio chat.
- **Paginación de tareas:** `getRecentAIJobs` (o una RPC nueva) acepta `limit` y `before` (cursor por `created_at`) y devuelve los conteos por estado para los filtros (`todas`, `en curso` = `pending` + `processing`, `con error` = `failed`, `para revisar` = Organizar con propuesta pendiente). La primera página trae las tareas de los últimos 7 días, o las 10 más recientes si son menos.
- **Reintentar:** si no hay una RPC de reintento segura, “Reintentar” crea una tarea nueva con el mismo tipo, entrada, modelo y contexto, y deja la fallida como está.
- Tests PGlite del trigger, del relleno, del cursor y de los conteos, más el aislamiento por negocio.
- **Commit:** `feat(ai): chat previews and paginated task lists`

### [x] H2 Navegación de IA en el celular
- Encabezado: título **IA** y la píldora de estado de la PC (“PC conectada” / “PC ocupada” / “PC desconectada”, con punto e ícono), que abre Conexión.
- Selector segmentado **Chats | Tareas | Más**. “Más” abre una hoja inferior con Conocimientos, Skills, Memoria, Conexión y Acciones (solo dueño), con ícono y una línea de descripción cada una.
- En `lg+`, las pestañas de hoy sin cambios.
- `Layout.tsx`: un mecanismo explícito (contexto o `useImmersiveMode()`) para ocultar la barra inferior y el encabezado móvil en las pantallas completas. Que no dependa de leer la URL desde el Layout.
- Respetá `env(safe-area-inset-bottom)`.
- **Commit:** `feat(ai): mobile navigation for the AI hub`

### [x] H3 Lista de chats (pantalla 1)
- Buscador que filtra por título y vista previa, sin acentos ni mayúsculas, con espera de 150 ms.
- Grupos **Hoy, Ayer, Esta semana** y luego por mes (“Octubre”).
- Fila compacta de 64 px o más: título en una línea, vista previa en una línea con color atenuado, y hora (hoy) o fecha corta.
- **Deslizar a la izquierda** muestra “Eliminar”. Alternativa accesible: mantener apretado abre un menú con “Eliminar”, y la conversación también tiene “Eliminar chat” en su menú “⋯”. La confirmación es una **hoja inferior propia** (“Se borran los mensajes y sus fuentes. No se puede deshacer.”), nunca `window.confirm`.
- Muestra primero los últimos 30 días y, abajo, “Ver chats anteriores (N)”.
- Botón flotante **“Nuevo chat”** por encima de la barra inferior.
- Estados: cargando (esqueletos), vacío (“Todavía no tenés chats. Preguntale algo a tu IA.” + botón) y error con reintento.
- **Commit:** `feat(ai): mobile chat list`

### [x] H4 Conversación (pantalla 2)
- Barra superior: volver, título en una línea, subtítulo con el punto de estado (“Codex en tu PC”) y menú “⋯” (Renombrar, Ajustes, Eliminar chat).
- Separadores de fecha (“Hoy”, “Ayer”, fecha).
- **Tus mensajes:** burbuja a la derecha, con un ancho máximo del 80 % y la hora debajo.
- **Respuestas:** texto a todo el ancho, sin tarjeta ni encabezado “Agente · fecha”, con el markdown actual (listas y negritas). Debajo, una fila de chips chicos:
  - fuentes: “N fuentes” se expande al tocar y muestra las actuales `[K1]…`, y “Tu stock” cuando usó datos del negocio;
  - memoria: “Usé N chats anteriores” cuando usó el índice de chats y el chip actual “Memoria actualizada · Deshacer”;
  - acción “Copiar” como ícono.
- **Compositor fijo abajo:**
  - chips “`<Modelo> · <Razonamiento>`” y “Datos del negocio” (tildado o no) que abren la pantalla 3;
  - botón “+” solo si hoy se pueden adjuntar imágenes al chat; si no, no se muestra;
  - `textarea` que crece de 1 a 5 líneas;
  - botón enviar redondo, deshabilitado sin texto;
  - contador solo a partir de 7.000 de 8.000 caracteres.
- **Teclado:**
  - el compositor queda pegado al teclado en Android y en iOS (con `visualViewport`), y se desplaza al último mensaje al enviar y al recibir;
  - mientras la PC responde, un indicador “Escribiendo…”;
  - si la PC está desconectada, aviso arriba del compositor y botón deshabilitado con explicación.
- **Commit:** `feat(ai): mobile chat conversation`

### [x] H5 Ajustes del chat (pantalla 3)
- Hoja inferior accesible:
  - **Modelo** con tres opciones (nombre y descripción);
  - **Razonamiento** segmentado (Bajo, Medio, Alto, Muy alto), con la ayuda “Bajo gasta menos de tu plan…”;
  - **Qué puede consultar:** interruptores “Datos del negocio” y “Proyecto RivaStock” (este último solo si hoy está permitido para el plan o la cuenta), más la nota “Tus Skills, la memoria y Conocimientos se usan siempre.”;
  - botón **Listo**.
- En un chat existente, el proveedor queda fijo (la sesión vive en la PC), pero **modelo, razonamiento y contexto se aplican a los mensajes siguientes**, si `sendAIChatMessage` ya los recibe por mensaje. Verificalo. Si el backend no lo permite, mostralos de solo lectura con la explicación y anotá el **Desvío**.
- Sin cambios en los valores por defecto ni en la configuración por función de T5.1.
- **Desvío comprobado:** en un chat existente, `ai_send_chat_message` rechaza cambios de `model_id` y `reasoning_effort`; la hoja los deja en solo lectura y explica que quedan fijos al crear el chat. Los dos toggles de contexto sí se aplican a cada mensaje siguiente.
- **Commit:** `feat(ai): chat settings sheet`

### [x] H6 Lista de tareas (pantalla 4)
- Mismo encabezado y selector que H2 (Tareas activo).
- Filtros: Todas · N, En curso · N, Con error · N y Para revisar · N (solo si hay), con los conteos de H1. El menú “⋯” contiene “Eliminar finalizadas”, con el comportamiento y la confirmación actuales, ahora en hoja inferior.
- Agrupadas por día. Cada fila tiene un ícono en círculo y el estado en texto:
  - **En proceso:** azul, con animación que respeta `prefers-reduced-motion`.
  - **Lista:** verde.
  - **Para revisar:** ámbar (propuesta de Organizar pendiente).
  - **Error:** rojo, con el motivo legible y un botón **Reintentar**.
- Título legible por tipo: “Publicación: <producto>”, “Revisión de fotos: <producto>”, “Organizar: <documento>”, “Texto: <primeras palabras>”.
- Primera página según H1 y, abajo, “Ver N tareas anteriores”.
- Botón flotante **“Nueva tarea”**.
- Las tareas en curso se actualizan solas con el mismo sondeo de hoy.
- **Commit:** `feat(ai): mobile task list`

### [x] H7 Detalle de tarea (pantalla 5)
- Barra: volver, título por tipo y chip de estado.
- Metadato: “<producto o documento> · <fecha y hora> · tardó N s”.
- **El resultado primero**, en una tarjeta.
  - Para Redacción: título y descripción por separado, con “Copiar” y “Usar en publicación”, que abre el flujo de publicación existente con el texto cargado. Si ese flujo no acepta texto precargado, solo “Copiar”, y anotalo.
  - Para Revisión de fotos: el resultado actual (orden y portada) adaptado al ancho.
  - Para Organizar: el acceso a la propuesta.
  - Para Texto: el texto con “Copiar”.
- Plegables “Lo que pediste” y “Detalles técnicos” (modelo, razonamiento, proveedor y contexto).
- Pie: “Repetir con cambios” (abre la pantalla 6 precargada) y “Eliminar” (hoja de confirmación).
- **Commit:** `feat(ai): mobile task detail`

### [ ] H8 Nueva tarea (pantalla 6)
- Pantalla completa con cerrar (X), que pide confirmar si hay texto escrito.
- Tipo de tarea en tres opciones grandes:
  - **Texto libre** (`text_generation`);
  - **Publicación para Facebook** (`fb_copywriting`): pide elegir el producto con un buscador, reutilizando la búsqueda de “Buscar y enviar”;
  - **Revisar fotos** (`fb_photo_review`): elegir el producto.

  Solo los tipos que la cuenta tiene habilitados por su plan y sus módulos (F2/F2b).
- Campo “Contale qué necesitás”, con un ejemplo como placeholder.
- Chips de modelo/razonamiento y de contexto, iguales a los de H4, que abren H5.
- Pie fijo con el estado de la PC (“Tu PC está conectada. Te avisamos cuando esté lista.”) y el botón **“Enviar a mi PC”**. Al enviar, va al detalle de la tarea nueva en estado “En proceso”.
- **Commit:** `feat(ai): mobile new task flow`

**Desvío vigente:** las RPC y el worker actuales de `fb_copywriting` y `fb_photo_review` no reciben el campo de texto libre ni los toggles de contexto. En esos dos tipos la interfaz los mantiene bloqueados y explica qué datos sí usa. H8 queda abierta; cambiar la lógica de generación excede el alcance de §4 y tocaría el flujo de PC.

### [x] H9 Cierre: pruebas y verificación en producción
- Playwright con viewport Android (390×844) e iPhone (390×844, WebKit):
  - lista → conversación → atrás (también con el botón atrás del navegador);
  - buscar;
  - deslizar y eliminar con confirmación;
  - nuevo chat y enviar un mensaje con `mock`;
  - ajustes;
  - tareas: filtros, paginación, detalle, reintentar, nueva tarea y estados vacíos;
  - la barra inferior se oculta en las pantallas completas.
- **PC sin cambios:** captura de Playwright a 1280 px antes y después de Chats y Tareas. La diferencia tiene que ser nula o explicada.
- Accesibilidad: foco y `Esc` en las hojas inferiores, `aria-label` en los íconos y contraste AA en los dos temas.
- `npm run lint`, `npm test`, `npm run build` y `npm run perf:check`.
- **Producción:** con el perfil persistente de Playwright en viewport móvil, recorré los seis flujos con datos `[QA]` y borralos desde la app al final. Capturas en `docs/design/mobile-ai/production/`, sin datos personales.
- Avisá en `MENSAJE_PARA_RIVA.md`: “El Chat IA y las Tareas del celular ya tienen el diseño nuevo”, más qué probar.
- **Commit:** `docs(ai): record mobile AI UX rollout`

## 4. Fuera de alcance
- Rediseño visual (colores, tipografías, identidad) y cambios en la versión de PC.
- Cambios en la lógica de IA, la memoria, los proveedores o los permisos.
