# Acciones del dueño pendientes

1. **A1 — decidir una ruta compatible con la instrucción de no usar el Dashboard.** La Management API y la CLI no generan las credenciales S3 de Storage; la única ruta documentada que encontramos es crearlas desde la configuración de Storage. Hasta que se autorice esa ruta (o Supabase ofrezca otra vía), no se puede migrar Storage ni apagar las claves legacy sin cortar operaciones activas.
2. **G2 catálogo — habilitar la verificación del preview protegido.** El preview de Vercel devuelve “Protected Deployment” a `curl` y Playwright sin sesión de Vercel. Habilitá un bypass de preview en Vercel para el verificador o permití el preview público durante la prueba; no compartas el secreto por chat.
3. **Facebook, C0 y ensayos en vivo — instalar una sola vez la extensión publicada 0.5.23.** Producción todavía reporta 0.5.22 sin `self-reload` ni `screenshots`. Después, cuando se hagan los ensayos, dejá Chrome abierto con la sesión de Facebook y aceptá el permiso de captura si aparece. Los ensayos los crearé por RPC y permanecerán en modo ensayo; no se publicará contenido.
4. **T6.1 — elegir los permitidos para ensayos:** marcar 3–5 productos y 5–10 grupos desde la app; dejar los demás sin marcar.

No se requieren acciones de Claude, instalación del Bridge ni limpieza manual de datos QA. I13 tuvo smoke móvil autenticado en producción sin escrituras; la única evidencia pendiente es recuperar una captura de escritorio previa a 1280 px, si todavía está disponible en un deployment histórico.
