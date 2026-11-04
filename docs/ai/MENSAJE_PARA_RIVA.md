## Bloque H verificado; I4/I5 listos localmente; sigo con I6

El Chat IA y las Tareas del celular ya tienen el diseño nuevo. Validé Chats y Tareas en Android y iPhone, y comparé la versión de PC a 1280 px: mantiene la misma composición; las únicas diferencias visuales son los minutos dinámicos de las fechas. Probé el envío de un chat con `MockProvider` en producción y eliminé el chat `[QA]` desde la app.

H8 queda abierto: Publicación para Facebook y Revisar fotos todavía no admiten el texto libre ni los toggles de contexto porque las RPC y el worker actuales no los reciben. La interfaz lo informa y no se cambió la lógica ni la instalación del Bridge de PC.

La lista y la ficha de Stock para el celular están implementadas y pasan la verificación local; todavía no se desplegaron. No necesitás hacer nada ahora. El cierre en producción queda para I9.

F1 (emails) sigue preparada sin desplegar hasta que compartas un dominio remitente verificado.
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
