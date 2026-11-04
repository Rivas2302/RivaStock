## Bloque I cerrado en producción — 04/11/2026

El Inicio y el Stock del celular ya tienen el diseño nuevo. Verifiqué con el perfil persistente de Playwright: crear un producto de prueba, abrir la ficha, sumar/restar/contar stock con motivo, bloquear un ajuste que dejaría stock negativo, editarlo, descartar cambios y borrarlo desde la app. «Vender» abre el POS con el producto y «Enviar fotos» abre la pantalla correspondiente.

La búsqueda final no encuentra el producto QA; tampoco quedan su fila ni existencias. El ledger conserva cuatro movimientos históricos del producto eliminado; el flujo normal de borrado no los purga y no los eliminé por SQL. Las capturas sanitizadas están en `docs/design/mobile-home-stock/production/`.

**Siguiente: A1, antes de cualquier otro bloque.** Abrí el Dashboard de Supabase de `RivaStock_Oficial` en Chrome y dejalo abierto. No compartas credenciales. Cuando esté listo, avisame y continúo con A1.

Para probar el diseño: buscá un producto, abrí su ficha, ajustá el stock con motivo y cargá uno nuevo sacando una foto.

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
