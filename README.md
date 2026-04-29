# RivaStock

**RivaStock** es una PWA de gestión de inventario, ventas y catálogo público para PyMEs. Permite gestionar productos, registrar ventas, controlar stock, generar presupuestos y publicar un catálogo online accesible para clientes.

## Stack

- **Frontend:** React 19, TypeScript, Vite 6, React Router 7, Tailwind CSS 4, Motion (Framer Motion), Recharts, D3
- **Backend:** Supabase (Auth, PostgreSQL con RLS, Storage)
- **Deploy:** Vercel (SPA con rewrites a `/index.html`)
- **PWA:** Service Worker + Web App Manifest

## Setup Local

### Requisitos

- Node.js >= 20
- npm

### Instalación

```bash
git clone https://github.com/Rivas2302/RivaStock.git
cd RivaStock
npm install
```

### Variables de Entorno

Crear un archivo `.env.local` en la raíz del proyecto:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Desarrollo

```bash
npm run dev
```

La app estará disponible en `http://localhost:5173/`.

### Build de Producción

```bash
npm run build
npm run preview
```

### Lint (TypeScript)

```bash
npm run lint
```

## Migraciones de Supabase

Las migraciones SQL se encuentran en `supabase/migrations/`:

- `0001_init.sql` — Schema de tablas, RLS, triggers
- `0002_rpcs.sql` — Funciones RPC (register_sale, edit_sale, etc.)

Para aplicarlas, ejecutalas en orden desde el **SQL Editor** del dashboard de Supabase, o con la CLI:

```bash
supabase db push
```

## Deploy en Vercel

1. Conectar el repo en [vercel.com](https://vercel.com)
2. Las variables de entorno de Supabase están configuradas en `vercel.json` bajo `build.env`
3. Build command: `npm run build`
4. Output directory: `dist`

## Estructura del Proyecto

```
src/
  main.tsx              # Entry point + Service Worker registration
  App.tsx               # Router + ProtectedRoute
  AuthContext.tsx        # Supabase Auth provider
  lib/
    supabase.ts          # Supabase client
    db.ts                # DB abstraction layer (camelCase ↔ snake_case)
  pages/                # Todas las páginas de la app
  components/           # Componentes reutilizables
public/
  sw.js                 # Service Worker (network-first para Supabase API)
  manifest.json         # Web App Manifest
supabase/migrations/    # Migraciones SQL
```

## Troubleshooting

### Spinner infinito al cargar

Si la app se queda con un spinner infinito:

1. Abrir DevTools → **Application** → **Service Workers**
2. Hacer click en **"Unregister"** en todos los Service Workers
3. Ir a **Application** → **Storage** → **"Clear site data"**
4. Recargar la página

### El catálogo público no carga

- Verificar que la URL sea correcta: `/catalogo/<slug>`
- Verificar que el catálogo esté habilitado en Configuración → Catálogo Público
- Verificar las políticas RLS en Supabase para acceso anónimo

## Licencia

Proyecto privado — © RivaTech
