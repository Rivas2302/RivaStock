---
name: RivaStock
description: Gestión diaria del comercio minorista, minimalista y premium, en claro y oscuro.
colors:
  light-bg: "#FFFFFF"
  light-surface-1: "#FAFAF9"
  light-surface-2: "#F4F4F3"
  light-surface-3: "#E8E8E6"
  light-ink: "#191919"
  light-ink-muted: "#6B6B6B"
  light-line: "#EDEDEC"
  light-accent: "#23705F"
  light-accent-ink: "#FFFFFF"
  light-accent-text: "#1D5E50"
  light-danger: "#C4382B"
  light-warning: "#A86F0C"
  light-chart-bar: "#DEDEDB"
  light-primary: "#191919"
  light-primary-ink: "#FFFFFF"
  dark-bg: "#121212"
  dark-surface-1: "#181818"
  dark-surface-2: "#202020"
  dark-surface-3: "#2B2B2B"
  dark-ink: "#F2F2F2"
  dark-ink-muted: "#A7A7A7"
  dark-line: "#262626"
  dark-accent: "#5FC2A5"
  dark-accent-ink: "#0E2A22"
  dark-accent-text: "#7DD3B8"
  dark-danger: "#F07B6E"
  dark-warning: "#E0A84A"
  dark-chart-bar: "#333333"
  dark-primary: "#F2F2F2"
  dark-primary-ink: "#121212"
typography:
  money-hero:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "3.5rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.045em"
  money-stat:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  page-title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  section-title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.005em"
  nav:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section-mobile: "36px"
  section-desktop: "44px"
components:
  button-primary:
    backgroundColor: "{colors.light-primary}"
    textColor: "{colors.light-primary-ink}"
    rounded: "{rounded.md}"
    height: "38px"
    padding: "0 16px"
  button-accent:
    backgroundColor: "{colors.light-accent}"
    textColor: "{colors.light-accent-ink}"
    rounded: "{rounded.md}"
    height: "38px"
    padding: "0 16px"
  button-secondary:
    backgroundColor: "{colors.light-bg}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.md}"
    height: "38px"
    padding: "0 14px"
  chip:
    backgroundColor: "{colors.light-surface-2}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.pill}"
    height: "34px"
    padding: "0 14px"
  chip-selected:
    backgroundColor: "{colors.light-accent}"
    textColor: "{colors.light-accent-ink}"
    rounded: "{rounded.pill}"
    height: "34px"
  quick-tile:
    backgroundColor: "{colors.light-surface-2}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.md}"
    height: "56px"
  search-field-mobile-dark:
    backgroundColor: "{colors.dark-ink}"
    textColor: "{colors.dark-bg}"
    rounded: "{rounded.md}"
    height: "48px"
  list-row:
    textColor: "{colors.light-ink}"
    height: "56px"
---

# DESIGN.md — RivaStock

Aprobado por Riva el 04/11/2026. Referencias visuales: `docs/design/redesign/referencia/` (Inicio y Stock en PC y celular; cada archivo tiene un botón para cambiar claro/oscuro). Lo que dice este archivo manda sobre cualquier color o letra que hoy esté en el código.

## Overview

Minimalista y premium, con la calma de Notion y la claridad de Spotify en oscuro. Una cosa principal por pantalla. Casi todo es tipografía sobre fondo liso: sin tarjetas encimadas, sin sombras de adorno y sin colores chillones. El color se reserva para lo que importa (la acción principal, la selección y los estados). Funciona igual de bien en claro y en oscuro, y cada persona elige el suyo.

Lo que Riva pidió evitar: colores chillones, mala estructuración y mucha información en una sola pantalla.

## Colors

- **Estrategia:** restringida. Neutros más un solo acento, el verde jade (`accent`). Se usa en el botón de acción más importante de cada pantalla (por ejemplo "Vender" o "Nueva venta"), en el filtro o chip elegido, en el interruptor encendido, en el mes actual de los gráficos y en los links de acción (`accent-text`).
- **Botón principal de una pantalla de gestión** ("Agregar producto"): `primary`, que es negro en claro y blanco en oscuro. El acento queda para la acción comercial.
- **Estados:** `danger` para sin stock, errores y eliminar; `warning` para stock bajo y pendiente de cobro. Se muestran como texto de color o un punto de 8 px, nunca como fondos saturados.
- **Superficies:** `bg` es el fondo. `surface-2` va en mosaicos, campos y avisos; `surface-3` en hover, íconos de mosaico y pistas de interruptor. `line` se usa para separadores de 1 px entre filas.
- **Prohibido:** índigo y violeta (`#6366f1` y similares), el fondo crema actual (`#f4f1ea`, `#fcfaf5`), los degradados y los `slate-*`, `indigo-*` y `emerald-*` sueltos de Tailwind. Todo color sale de un token.

## Typography

- **Una sola familia:** Hanken Grotesk (300 a 700), con `font-variant-numeric: tabular-nums` en todo número.
- **Montos:** el signo `$` va al 58 % del tamaño, peso 400, opacidad 55 % y elevado unos 0,36 em; el número va en peso 500 con interletrado negativo. Crear un componente `<Money>` y usarlo en todos los montos de 17 px o más. Los montos de tablas y filas van en texto normal ("$ 7.000").
- **Escala:** título de página de 32 px (28 px en el celular), título de sección de 17 a 19 px, cuerpo de 14 a 15 px, etiqueta de 12 a 13 px en `ink-muted`. Nunca menos de 11 px.
- Etiquetas en minúscula normal, sin MAYÚSCULAS ni letras espaciadas.

## Layout

- **PC:** menú lateral de 248 px en `surface-1` con los grupos de hoy (Operación, Relaciones, Gestión, Sistema), el selector de negocio arriba y el usuario abajo. Contenido de 1120 px como máximo. Secciones separadas por 44 px y una línea `line`.
- **Celular (menos de 1024 px):** una columna con margen de 20 px y secciones separadas por 36 px. Barra inferior con 5 destinos y un menú completo en el encabezado.
- **Jerarquía en el Inicio:** primero lo de hoy, después qué atender, el mes, la mercadería y las últimas ventas.
- Grillas de datos alineadas, con números a la derecha en tablas.

## Elevation & Depth

Plano. Solo flotan los menús, las hojas inferiores y el botón flotante, con sombra suave (`0 12px 32px rgba(0,0,0,.16)`). Sin bordes de color a un costado y sin sombras duras.

## Shapes

Radios de 6 px (íconos, miniaturas), 8 px (botones, campos, mosaicos) y 10 px (avisos, menús). Los chips y los selectores de negocio llevan forma de píldora.

## Components

- **Mosaico de acceso rápido** (al estilo de los accesos de Spotify): 56 px de alto, cuadrado de ícono de 56 px a la izquierda (acento solo en "Vender") y etiqueta de 14 px en peso 600.
- **Fila de lista:** 56 a 68 px, separador de 1 px, miniatura de 52 px con radio de 6 px, nombre de 15 px y detalle de 13 px en `ink-muted`. A la derecha, el estado o la cantidad.
- **Tabla de PC:** sin cajas. Encabezado de 12 px en `ink-muted` y filas separadas por `line`. Las acciones de cada fila quedan en "Editar" más un menú "⋯" (ajustar stock, código y etiqueta, copiar enlace, Facebook, movimientos y eliminar).
- **Interruptor:** de 36×22, pista `surface-3` y acento cuando está encendido.
- **Segmentado:** contenedor `surface-2` con la opción elegida en `bg` y una sombra mínima.
- **Buscador:** en el celular oscuro es un campo claro (`ink` sobre `bg`) al estilo Spotify; en claro y en la PC, `surface-2`.
- **Avisos:** franja `surface-2` con un punto de estado, texto, un link de acción y cierre.
- **Gráficos:** barras planas `chart-bar`, el período actual en acento, el valor arriba de cada barra y la unidad aclarada ("en miles de pesos").

## Do's and Don'ts

- Mantener todas las funciones de cada pantalla: el rediseño cambia cómo se ve y cómo se ordena, nunca qué se puede hacer.
- Una acción principal por pantalla; las secundarias van como botones con borde o en el menú "⋯".
- Escribir para el mostrador: "Vendiste hoy", "Te deben", "Para reponer", "Ganancia si vendés todo".
- No usar tarjetas dentro de tarjetas, sobretítulos encima de los títulos, emojis como íconos, texto con degradado ni efectos de vidrio.
- No usar el acento como decoración, ni colores de estado sin un significado.
- Íconos de trazo de 1,8 px, de una sola librería (la de hoy, `lucide-react`).
