# Roadmap posterior a la automatización de cuenta única

Nada de este documento es requisito para terminar ([`PLAN.md`](PLAN.md) §1). Retomar un ítem solo cuando se cumpla su condición de entrada y con planificación propia sobre el código de ese momento.

## 1. Mejoras posteriores (derivadas de esta investigación)

| Prioridad | Mejora | Problema que resuelve | Condición que la justifica | Dependencias |
|---|---|---|---|---|
| Alta | Aviso proactivo (correo o notificación web) cuando un destino queda desconocido, falla la preparación o la PC pasa > 30 min sin señal con trabajos pendientes. | Hoy los fallos son visibles solo al abrir RivaStock. | Un caso real en el que un fallo pasó inadvertido más de un día, o la persona usuaria lo pide. | Terminado el plan. Revisar si `supabase/functions` ya ofrece un mecanismo de correo reutilizable. |
| Media | Vencimiento periódico en servidor (`pg_cron` llamando una variante de servicio de `refresh_facebook_delivery_states`). | Los leases vencidos solo se procesan al abrir la web. | Necesidad de métricas/alertas que dependan del estado sin abrir la web (p. ej. el aviso anterior). | Disponibilidad de `pg_cron` en el plan de Supabase. |
| Media | Ritmo entre publicaciones de grupo (espera configurable entre destinos). | Riesgo no medido de restricciones por publicar en muchos grupos seguidos (D-A6). | Advertencia, restricción o checkpoint de Facebook observado tras publicar en varios grupos. | Ninguna; cambio en `worker.poll` (drain). |
| Media | Detector Marketplace adicional. | Si A15 muestra que Facebook no expone aviso causal ni navegación al artículo. | Resultado de A15. | A15. |
| Baja | Consolidar la cadena de wrappers SQL (`facebook_worker_v2` → `_validated_state` → …) en una migración que redefine una sola función. | Cada cambio exige leer varias capas. | Más de una nueva capa necesaria en el mismo año, o un bug causado por la cadena. | Suite C2/C5 como red de seguridad. |
| Baja | Selectores robustos a idioma (no solo `aria-label` en español). | Interfaz de Facebook en otro idioma. | Un negocio o perfil con Facebook en otro idioma. | Fixtures por idioma. |
| Baja | Instantánea/digest de fotos al aprobar. | Las URLs de Storage no garantizan bytes inmutables. | Evidencia de reemplazo de fotos entre aprobación y envío. | Política de Storage. |

## 2. Objetivos futuros documentados en el proyecto

| Objetivo | Fuente | Qué falta decidir antes de planificar |
|---|---|---|
| Publicar una campaña desde varias cuentas de Facebook | [`../facebook-multi-account-roadmap.md`](../facebook-multi-account-roadmap.md) | Identidad verificable de la cuenta por formulario, asignación cuenta↔perfil↔PC, política de duplicados entre cuentas, capacidad objetivo. |
| Ofrecer RivaStock y la automatización a otros negocios | Mismo documento | Aislamiento y soporte por negocio, distribución de la extensión, responsabilidad frente a políticas de Facebook. |
| Instalación desde Chrome Web Store | `../facebook-publication.md` («Para instalar mediante un botón…») | Cuenta de desarrollador, revisión de la tienda, compatibilidad con el `key`/ID actual, actualización automática vs. ZIP. |
| Secciones Comunicación y Analítica en Automatizaciones | `../automations.md` («secciones informativas próximas») | Alcance funcional: no hay requisitos escritos. |

Condición de entrada común: `PLAN.md` §1 cumplido y al menos 30 días de operación de cuenta única con el registro de resultados (aprobaciones, éxitos, pendientes de moderación, desconocidos, preparaciones fallidas).

## 3. Extensiones propuestas (no pedidas; propuesta del planificador)

- **Compartir el anuncio de Marketplace en grupos («Publicar en más lugares»)** en lugar de posts independientes. Hoy está explícitamente no implementado. Evaluar solo si la persona usuaria prefiere un único anuncio con alcance en grupos.
- **Reporte semanal** de resultados por destino a partir de `facebook_delivery_attempts`, útil para decidir qué grupos rinden. Requiere definir qué métrica importa al negocio.
