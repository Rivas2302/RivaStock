## Acción pendiente para cerrar H9 en producción

Cuando puedas, iniciá sesión en la ventana de Playwright con el perfil persistente `C:\Users\USER\rivastock-qa-profile` y dejala abierta en RivaStock. Las pruebas locales de Android, iPhone y escritorio ya pasaron; el smoke autenticado de H5/H9 y las capturas de producción siguen pendientes. No compartas tu contraseña. No se crearon datos `[QA]` de producción.

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
