# Línea base de Impeccable — J0

Generado: 2026-11-04 · Herramienta: `npx impeccable detect --json src/`

## Resumen

**Total hallazgos: 195** (todos advisory; ninguno bloquea el build)

| Regla | Hallazgos |
|---|---|
| `design-system-font-size` — tamaño fuera de la escala tipográfica de DESIGN.md | 127 |
| `design-system-color` — color fuera de los tokens (índigo, crema, slate-*, values literales) | 27 |
| `design-system-radius` — radio fuera del sistema (6/8/10/999 px) | 18 |
| `ai-color-palette` — uso de colores generados por IA sin token | 10 |
| `design-system-font` — familia tipográfica fuera de Hanken Grotesk | 6 |
| `side-tab` — tabs laterales (prohibidos en DESIGN.md) | 4 |
| `overused-font` — peso de fuente repetido sin jerarquía | 3 |

## 10 pantallas más afectadas

| Archivo | Hallazgos |
|---|---|
| `src/styles/public-settings.css` | 26 |
| `src/styles/knowledge.css` | 21 |
| `src/pages/PublicCatalog.tsx` | 13 |
| `src/pages/Reports.tsx` | 13 |
| `src/index.css` | 10 |
| `src/pages/Sales.tsx` | 10 |
| `src/pages/Stock.tsx` | 8 |
| `src/pages/AIHub.tsx` | 7 |
| `src/components/AIMemory.tsx` | 6 |
| `src/pages/CashFlow.tsx` | 6 |

## Meta para J3

Cero hallazgos sin justificación documentada en `.impeccable/ignores.json`.
