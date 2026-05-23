# EXECUTION PLAN — QR Code Compartible por Catálogo Público

**Fecha**: 2026-05-23  
**Scope**: Client-side only. Sin cambios a backend, Supabase, ni Firestore schema.  
**Estimación**: 3 tareas, ~1-2h de implementación total.

---

## ANÁLISIS PREVIO

### Hallazgos clave del codebase

| Aspecto | Detalle |
|---|---|
| URL real del catálogo | `${window.location.origin}/catalogo/${user?.catalogSlug}` (no `/:slug`) |
| Punto de integración principal | `Settings.tsx` → tab `catalog`, línea ~624–647: row flex con Copy + ExternalLink |
| Librería QR disponible | **Ninguna** — hay que instalar |
| Modal reutilizable | `src/components/Modal.tsx` — animado con `motion/react`, tamaño max-w-2xl |
| Icono QR en Lucide | `QrCode` — disponible en lucide-react ^0.475.0 |
| Web Share API | Ya se usa `Share2` icon en PublicCatalog.tsx — precedente existe |
| Auth | `user.catalogSlug` disponible desde `useAuth()` en toda la app |
| Stack de animación | `motion` + `AnimatePresence` — ya importado en Settings y Modal |
| Dark mode | `dark:` utilities de Tailwind — seguir el patrón `bg-white dark:bg-slate-900` |

### Librería QR elegida: `qrcode.react` v4.x

**Por qué esta y no otras:**
- `qrcode.react`: exporta `QRCodeCanvas` (canvas nativo) → PNG download con `canvas.toDataURL()` sin conversiones intermedias. TypeScript types incluidos. ~7kB gzip. No deps.
- `react-qr-code` (descartada): SVG only — PNG download requiere SVG→Canvas conversion manual, más código.
- `qrcode` raw (descartada): sin componente React, hay que manejar el canvas imperativamente.

---

## TAREAS

---

### TAREA 1 — Instalar librería QR

**Archivo afectado**: `package.json`  
**Comando**:
```
npm install qrcode.react
```

**Verificación**: `package.json` tiene `"qrcode.react": "^4.x.x"` en `dependencies`.  
**Tiempo estimado**: 2 min.

---

### TAREA 2 — Crear componente `CatalogQRModal`

**Archivo a crear**: `src/components/CatalogQRModal.tsx`  
**Archivos de referencia**: `src/components/Modal.tsx` (estructura), `src/pages/Settings.tsx` (patrones Tailwind)

#### Props interface
```ts
interface CatalogQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  catalogUrl: string;   // full URL: window.location.origin + '/catalogo/' + slug
  businessName: string; // para el filename de descarga y el título
}
```

#### Comportamiento

**Display del QR:**
- Usar `<QRCodeCanvas>` de `qrcode.react` con:
  - `size={220}`
  - `level="H"` (corrección de errores alta — permite logos superpuestos en el futuro)
  - `includeMargin={true}`
  - `ref={canvasRef}` — para acceder al canvas en download
- Centrado en modal con fondo blanco explícito (el QR siempre debe ser `bg-white` independiente del dark mode)

**Acción 1 — Descargar PNG:**
```ts
const handleDownload = () => {
  const canvas = canvasRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const a = document.createElement('a');
  a.download = `qr-${businessName.toLowerCase().replace(/\s+/g, '-')}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
};
```
- Icono: `Download` de lucide-react
- Clase: botón primario indigo (igual que el rest de la app)

**Acción 2 — Copiar link:**
```ts
const [copied, setCopied] = useState(false);
const handleCopy = async () => {
  await navigator.clipboard.writeText(catalogUrl);
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
};
```
- Icono: alterna entre `Copy` y `Check` (con `AnimatePresence` o simple ternario)
- Clase: botón secundario (borde slate)

**Acción 3 — Web Share API:**
```ts
const canShare = typeof navigator !== 'undefined' && !!navigator.share;
const handleShare = () => {
  navigator.share({
    title: `Catálogo de ${businessName}`,
    text: '¡Mirá nuestro catálogo!',
    url: catalogUrl,
  });
};
```
- El botón de Share solo se renderiza si `canShare === true` (mobile / PWA)
- Icono: `Share2` de lucide-react

#### Layout del modal
```
┌─────────────────────────────────┐
│ [título: "Compartir Catálogo"]  X│
├─────────────────────────────────┤
│                                 │
│     ┌─────────────────┐         │
│     │   [QR CODE]     │         │  ← bg-white siempre, padding 16px, rounded-2xl
│     └─────────────────┘         │
│                                 │
│  URL: [monospace truncado]      │
│                                 │
│  [ ↓ Descargar PNG ]            │  ← full width, indigo
│  [ □ Copiar link   ] [↑ Compartir]│  ← 2 col o 1+1
└─────────────────────────────────┘
```

#### Offline-safety
- `QRCodeCanvas` genera el QR en canvas sin red — funciona offline por diseño.
- `navigator.clipboard` y `navigator.share` son APIs del browser — sin red.
- No hay fetch ni Supabase calls en este componente.

**Tiempo estimado**: 30-45 min.

---

### TAREA 3 — Integrar botón QR en Settings > tab Catalog

**Archivo afectado**: `src/pages/Settings.tsx`

#### Cambios necesarios

**3a. Imports a agregar** (línea ~15, bloque de lucide-react):
```ts
import { QrCode } from 'lucide-react';          // icono del botón
```
```ts
import CatalogQRModal from '../components/CatalogQRModal';
```

**3b. Estado a agregar** (cerca de la línea ~62, bloque de estados):
```ts
const [isQRModalOpen, setIsQRModalOpen] = useState(false);
```

**3c. Botón QR en el row existente** (línea ~636–646, después del botón Copy y antes del `<a>` ExternalLink):
```tsx
<button
  onClick={() => setIsQRModalOpen(true)}
  className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
  title="Ver QR del catálogo"
>
  <QrCode size={18} />
</button>
```

El row resultante tendrá 4 elementos: `[URL display] [Copy] [QR] [ExternalLink]`

**3d. Render del modal** (al final del JSX del componente, antes del último `</div>`):
```tsx
{catalogConfig && (
  <CatalogQRModal
    isOpen={isQRModalOpen}
    onClose={() => setIsQRModalOpen(false)}
    catalogUrl={`${window.location.origin}/catalogo/${user?.catalogSlug}`}
    businessName={user?.businessName || 'Mi Tienda'}
  />
)}
```

**Tiempo estimado**: 10-15 min.

---

## ORDEN DE EJECUCIÓN

```
1. npm install qrcode.react
2. Crear src/components/CatalogQRModal.tsx (desde cero)
3. Editar src/pages/Settings.tsx (3 ediciones puntuales)
```

Las tareas 2 y 3 son dependientes (3 importa lo que crea 2).

---

## CRITERIOS DE ACEPTACIÓN

- [ ] El botón QR aparece en Settings > Catálogo Público junto a Copy y ExternalLink
- [ ] Al hacer click se abre un modal con el QR scannable apuntando a `/catalogo/{slug}`
- [ ] "Descargar PNG" descarga un archivo `.png` válido del QR
- [ ] "Copiar link" copia la URL y muestra feedback visual (icono cambia a ✓)
- [ ] "Compartir" usa Web Share API y solo aparece en browsers que la soportan
- [ ] El QR se renderiza offline (sin conexión a internet)
- [ ] Dark mode: el modal respeta el tema; el QR siempre tiene fondo blanco
- [ ] No hay errores de TypeScript (`npm run lint` pasa)
- [ ] El modal cierra con Escape y con el botón X (heredado de Modal.tsx)

---

## RIESGOS / NOTAS

| Riesgo | Mitigación |
|---|---|
| `canvas.toDataURL()` puede fallar en Safari si el canvas está "tainted" | `QRCodeCanvas` no carga imágenes externas → no habrá taint. Safe. |
| `navigator.share` no existe en desktop Chrome/Firefox | Guard `if (canShare)` antes de renderizar el botón — ya contemplado |
| `navigator.clipboard` requiere HTTPS o localhost | Vercel deploy siempre HTTPS; dev server en localhost → OK |
| `user?.catalogSlug` puede ser `undefined` si el perfil no cargó aún | Pasar la prop solo cuando `catalogConfig && user?.catalogSlug` existen — ya así en el tab |
| `qrcode.react` y Vite ESM | qrcode.react v4.x es ESM-compatible; no requiere config adicional en vite.config |

---

## FUERA DE SCOPE (no implementar)

- QR por producto individual (distinto al QR del catálogo completo)
- Personalización visual del QR (colores, logo superpuesto)
- Tracking de escaneos
- Generación server-side del QR
- Cambios al Service Worker
