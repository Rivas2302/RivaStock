## Bloque I — implementación local lista; falta cerrar el smoke en producción

- Backup fresco verificado: 96 tablas / 14.235 filas y 789 objetos Storage. La migración `20261104124859_mobile_stock_adjustments` está aplicada; producción confirma permisos y guardas de suspensión.
- I7 e I8 pasan lint, 936 pruebas unitarias y 40 escenarios E2E (23 omitidos por alcance del proyecto). Capturas de PC a 1280×900: 0 píxeles distintos en Inicio, Stock y editor. El bundle está dentro del presupuesto.
- No hay productos de stock `[QA]` en producción. Para terminar I6/I7/I9 tengo que publicar el frontend, crear un producto `[QA]` desde la app, hacer el smoke SQL únicamente dentro de `BEGIN … ROLLBACK`, probar el flujo móvil y borrar el producto desde la app. Todavía no hice cambios de datos.
- No necesitás hacer nada ahora. F1 (emails) sigue preparada sin desplegar hasta que compartas un dominio remitente verificado.

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
