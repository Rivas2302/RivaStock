# Contrato de acciones de IA

El catálogo `public.ai_actions_catalog` contiene acciones estáticas que pueden solicitar los futuros flujos de Skills. Toda acción que pueda cambiar el estado de Facebook requiere confirmación explícita del dueño en RivaStock.

## `facebook.publish_product`

La acción prepara un borrador para un producto del negocio autenticado. Una solicitud nunca crea filas en `facebook_publications` ni `facebook_deliveries`; eso ocurre únicamente cuando el dueño revisa el borrador y lo confirma desde **IA → Acciones** o **Automatizaciones**.

Parámetros:

```json
{
  "product_id": "uuid",
  "marketplace": true,
  "groups": ["uuid"],
  "group_mode": "separate",
  "use_ai_copy": false,
  "schedule_at": "2026-11-03T20:00:00.000Z"
}
```

`product_id`, `marketplace`, `group_mode` y `use_ai_copy` son obligatorios. `groups` y `schedule_at` son opcionales. `groups` admite hasta 20 UUID distintos, todos registrados para la misma cuenta. `group_mode` acepta `separate` o `marketplace_groups`; este último exige Marketplace y por lo menos un grupo. Si Marketplace está desactivado, se requiere al menos un grupo. `schedule_at` debe ser una fecha futura con zona horaria.

### Solicitar y revisar

La llamada desde un flujo autenticado es:

```ts
const { data: requestId, error } = await supabase.rpc('request_ai_action', {
  p_action: 'facebook.publish_product',
  p_params: params,
  p_source: 'skill:inventory-assistant',
});
```

`p_source` es una etiqueta de auditoría de 1 a 80 caracteres (`A-Z`, `a-z`, dígitos, punto, guion bajo, dos puntos y guion). El servidor valida el esquema, la propiedad del producto y los grupos; rechaza solicitudes de colaboradores y guarda un borrador pendiente en `ai_action_requests`. El dueño ve las solicitudes pendientes en IA y Automatizaciones. Puede descartar una solicitud con `cancel_ai_action(p_request_id)`.

Si `use_ai_copy` es `true`, el dueño selecciona la condición real del producto, genera una propuesta con la función existente de redacción asistida, aplica la propuesta al editor y la revisa. La IA no aplica ni confirma el contenido automáticamente. Ubicación, categoría, fotos, grupos y horario también se revisan en el editor.

### Confirmación

El editor final llama a:

```ts
const { data: publicationId, error } = await supabase.rpc('confirm_ai_action', {
  p_request_id: requestId,
  p_params: reviewedParams,
  p_content: reviewedContent,
  p_repeat_of: priorPublicationId ?? null,
});
```

La RPC solo admite al dueño autenticado, vuelve a validar el producto, los grupos y el horario, y llama en una transacción a `approve_facebook_publication_v2`. El ID de solicitud funciona como clave idempotente. Los reintentos idénticos devuelven la publicación ya creada; los datos distintos se rechazan. La confirmación del dueño agrega los destinos a la cola existente de Facebook, que conserva sus controles de conexión, ritmo, programación y revisión.

Los clientes y futuras Skills deben usar `request_ai_action`; no deben llamar a `approve_facebook_publication_v2`, ni intentar confirmar desde un flujo automático. `requires_confirmation` queda en `true`; la aprobación automática está fuera del alcance.
