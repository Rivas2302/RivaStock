# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Dueños y empleados de comercios minoristas de cualquier rubro en Argentina (tecnología y accesorios, ropa, ferretería, regalería, etc.). El uso se reparte mitad y mitad: en el celular en el mostrador, con el cliente enfrente (vender, consultar precios, mandar fotos de productos por WhatsApp, Instagram, Messenger o TikTok, ajustar stock), y en la PC del negocio (cargar productos, caja, reportes, proveedores, presupuestos). Los colaboradores pueden tener permisos limitados (por ejemplo, stock solo lectura).

## Product Purpose
RivaStock es la gestión diaria de un comercio chico en una sola app: stock (con titulares de la mercadería), ventas y POS con código de barras, caja, clientes, proveedores y compras, presupuestos con link público, pedidos, reportes y un catálogo público con link por producto para compartir. Éxito: el comercio vende y responde más rápido, sabe cuánta plata tiene y qué reponer, sin planillas.

## Positioning
Lo arma y lo instala RivaTech (integrador de tecnología para pymes) negocio por negocio. Plan "RivaStock" sin IA y "RivaStock IA": con una PC central del comercio que corre la IA localmente (chat con el conocimiento del negocio, tareas, publicador supervisado en grupos de Facebook). Pensado para el mostrador argentino: pesos, efectivo y transferencia, cobros pendientes, listas para revendedores.

## Operating Context
PWA en celulares Android e iPhone y en PC. Se usa con apuro y con el cliente esperando, muchas veces con una mano. Fotos de productos sacadas con el celular. Escáner de código de barras con la cámara. El catálogo público lo ven clientes finales y revendedores desde WhatsApp o redes. Tema claro y oscuro.

## Capabilities and Constraints
React + TypeScript + Tailwind 4 (tokens CSS en `src/index.css`), Supabase, Vercel. Multi-negocio con planes y módulos (IA, Conocimientos, Automatizaciones). Cuentas suspendidas quedan en solo lectura. Admin de plataforma en `/plataforma`. Sin dependencias nuevas de UI sin motivo.

## Brand Commitments
Se conserva solo el nombre "RivaStock" (y "RivaStock IA" para el plan con IA). Colores, tipografía y logo se pueden reemplazar por completo. Riva pidió que el diseño "no parezca hecho por IA". Dirección aprobada el 04/11/2026: minimalista y premium, con referencias de Spotify y Notion, en claro y oscuro (ver DESIGN.md). Evitar colores chillones, mala estructuración y mucha información en una sola pantalla.

## Evidence on Hand
Datos reales de negocio en producción (no usar en maquetas: los montos y productos de las maquetas son de ejemplo). Fotos de productos subidas por cada comercio, de calidad variable. No hay logo propio: el favicon actual es una "R" blanca sobre índigo #6366f1.

## Product Principles
1. El mostrador primero: lo que se hace con el cliente enfrente se resuelve en uno o dos toques.
2. Plata y stock siempre claros: números grandes, estados sin ambigüedad.
3. Sirve a cualquier rubro: nada de la interfaz asume un tipo de producto.
4. El catálogo público es la cara del comercio, no de RivaStock.
5. Mismo sistema en celular y PC; cambia la estructura, no el idioma visual.

## Accessibility & Inclusion
Contraste AA en ambos temas, objetivos táctiles de 44 px, texto legible a pleno sol en el mostrador.
