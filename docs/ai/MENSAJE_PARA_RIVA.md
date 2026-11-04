## Bloque I — falta cierre autenticado en producción

- Vercel confirmó `success` para `1bc0f04`; producción devuelve HTTP 200 y sirve el bundle nuevo. Se corrigió el `\n` literal que rompía el build de `e9cf831`.
- Build, `perf:check`, lint, **938 pruebas unitarias** y **40 E2E** pasan. Contraste AA para textos móviles verificado en ambos temas. Las capturas deterministas a 1280×900 de Inicio, Stock y editor coinciden píxel por píxel con `e9cf831`.
- Backup verificado: 96 tablas / 14.235 filas y 789 objetos Storage. La migración `20261104124859_mobile_stock_adjustments` ya está aplicada; su smoke transaccional todavía requiere un producto de prueba.
- **Acción tuya:** cerrá Chrome por completo, sin cerrar sesión ni borrar el perfil `C:\Users\USER\rivastock-qa-profile`, y avisame **“Chrome cerrado”**. Chrome tiene procesos activos sin CDP y Playwright no puede usar ese perfil mientras está bloqueado.
- No hay productos `[QA]` de stock creados y no hubo escrituras nuevas en producción. Con el perfil desbloqueado voy a crear el producto `[QA]` desde la app, ejecutar el smoke únicamente con `BEGIN … ROLLBACK`, recorrer el flujo móvil y borrar el producto desde la app.
- F1 (emails) sigue preparada sin desplegar hasta que compartas un dominio remitente verificado.
- F1 (emails) sigue preparada sin desplegar hasta que compartas un dominio remitente verificado.

# Tanda 1 lista para revisar

Riva, terminé los 8 bocetos de la Tanda 1. Podés abrirlos desde el índice:

👉 **[docs/design/redesign/index.html](docs/design/redesign/index.html)**

## Qué hay en la tanda

| Pantalla | PC | Celular |
|---|---|---|
| Ventas | ✅ | ✅ |
| Punto de venta (POS) | ✅ | ✅ |
| Consulta rápida | ✅ | ✅ |
| Buscar y enviar | ✅ | ✅ |

## Qué tiene cada boceto

- Tokens CSS de DESIGN.md (`.t-claro` / `.t-oscuro`)
- Tipografía Hanken Grotesk 300–700
- Toggle claro/oscuro en cada archivo
- Datos de ejemplo en pesos argentinos
- **Inventario completo de funciones** en un comentario HTML al inicio de cada archivo
- Todos los estados: vacío, cargando, error, oversell, código desconocido

## Qué NO toqué

- `src/`, `supabase/`, `extensions/` — sin cambios
- J2 sigue bloqueada hasta que H9 e I9 estén marcados y me des el OK

## Próximo paso mío

Mientras revisás, puedo arrancar la **Tanda 2**: Flujo de caja, Ingresos, Clientes, Presupuestos.
Avisame cuando termines de mirar.

---
_[Claude Code] · 2026-11-04 · claude/redesign_

# Tanda 1 lista para revisar
