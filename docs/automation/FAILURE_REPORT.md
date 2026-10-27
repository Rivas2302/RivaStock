# Fallas de producción del publicador de Facebook

## Alcance y método

Corte de solo lectura sobre `RivaStock_Oficial`, realizado el 26/10/2026 ART. Se analizaron todas las filas de `facebook_deliveries` (97) y `facebook_delivery_attempts` (101), junto con el dispositivo asociado y los eventos de intento. Los intentos abarcan desde 2026-10-15 15:18:16 UTC hasta 2026-10-19 14:35:13 UTC. El heartbeat activo observado al cierre reportó extensión 0.5.15 a las 2026-10-27 01:49:48 UTC.

No se alteró la base. El informe no incluye UUID, nombre de grupo, URL ni contenido de publicación. Los grupos se presentan con alias G01…G10.

Hay dos límites de auditoría del esquema actual:

- `facebook_delivery_attempts` guarda código/outcome, autorización y tiempos, pero no una copia inmutable de `extension_version` ni de `message` por intento. La versión listada abajo es la versión actual de `facebook_devices` para el dispositivo asociado; el mensaje es el mensaje actual de la entrega. No se afirman como snapshots históricos.
- Los 101 intentos tienen `finished_at`. La duración por intento es `finished_at - started_at`; una entrega sin intento no tiene duración de worker calculable.

## Resultados agregados

### Estado de entregas

| Mecanismo | Entregas | `attention` | `cancelled` | `pending_approval` | `submitted` | `published` |
|---|---:|---:|---:|---:|---:|---:|
| Grupo directo | 81 | 39 | 34 | 2 | 5 | 1 |
| Marketplace | 16 | 8 | 4 | 3 | 1 | 0 |
| **Total** | **97** | **47** | **38** | **5** | **6** | **1** |

`submitted` no se cuenta como éxito: seis entregas todavía muestran mensajes de resultado desconocido o evidencia pendiente. La única fila `published` no tiene intento asociado y no se atribuye al worker.

### Estado de intentos y tasa de éxito automático

| Mecanismo | Entregas | Intentos | Clic autorizado | Interrumpidos antes del clic | Resultado desconocido | Éxito automático confirmado |
|---|---:|---:|---:|---:|---:|---:|
| Grupo directo | 81 | 88 | 31 | 57 | 31 | **0/88 (0%)** |
| Marketplace | 16 | 13 | 4 | 9 | 4 | **0/13 (0%)** |
| **Total** | **97** | **101** | **35** | **66** | **35** | **0/101 (0%)** |

`PREPARATION_INTERRUPTED` aparece en 66 intentos y ninguno tiene `authorized_at`. `RESULT_UNKNOWN` aparece en 35 y todos tienen `authorized_at`. No hubo intentos con outcome de éxito publicado. El único `published` en la tabla de entregas no está enlazado a un intento.

### Duración

| Mecanismo | Media | Mediana | P95 |
|---|---:|---:|---:|
| Grupo directo | 48,887 ms | 16,254 ms | 276,817 ms |
| Marketplace | 22,138 ms | 22,770 ms | 36,398 ms |

### Códigos de extensión reportados por el dispositivo asociado

Distribución de intentos según el `extension_version` actual del registro de dispositivo al corte; no representa necesariamente la versión que ejecutó cada intento histórico.

| Versión actual del dispositivo | Intentos asociados |
|---|---:|
| 0.5.3 | 27 |
| 0.5.13 | 14 |
| 0.5.0 | 11 |
| 0.5.15 | 10 |
| 0.5.7 | 7 |
| 0.5.14 | 6 |
| 0.5.4 | 5 |
| 0.5.5 | 5 |
| 0.5.9 | 5 |
| 0.5.1 | 4 |
| 0.5.10 | 4 |
| 0.5.8 | 2 |
| 0.5.11 | 1 |

### Ranking de causas técnicas

El conteo de mensajes se une con el mensaje final actual de la entrega; puede haber varios intentos por entrega. Para los resultados desconocidos prevalece el código de intento (`RESULT_UNKNOWN`), que es el dato estable.

| Prioridad | Causa observada | Casos | Estado de clic | Trabajo que la ataca |
|---:|---|---:|---|---|
| 1 | Resultado desconocido después de un clic | 35 intentos: 31 grupo directo, 4 Marketplace | 35 autorizados | T3.1 captura observaciones; T3.2 verifica con ID nuevo del DOM y validación del servidor; T3.3 revisa desconocidos históricos sin reenviar. |
| 2 | Validación u orden de fotos distinto del baseline | 27 intentos ligados a esos mensajes: 23 grupo, 4 Marketplace; 17 sin autorización y 10 con autorización registrada | Mezcla; los autorizados siguen siendo desconocidos | T2.2 `review_photos` y T2.4 autocorrección con revalidación determinista. No se puede cambiar el contenido aprobado ni sortear el guard. |
| 3 | Timeout durante un paso | 10 intentos: 8 grupo, 2 Marketplace; 0 autorizados. Seis esperan el editor del grupo | Ninguno | T2.4 supervisa la espera y vuelve a validar; T1.3 conserva el paso y la captura/DOM. |
| 4 | Excepción `startsWith` sobre `null` al crear snapshot de contenido propio | 4 intentos: 3 grupo, 1 Marketplace; 0 autorizados | Ninguno | T2.4 agrega baseline null-safe y regresión en `own_content_snapshot`; nunca se acepta texto de pantalla como evidencia. |
| 5 | Lista de anuncios existentes sin IDs utilizables | 1 intento Marketplace; 0 autorizados | Ninguno | T2.4 agrega regresión de lista incompleta; el paso permanece bloqueado hasta verificar que la lista está completa. |

Fuera del ranking funcional: 18 intentos quedaron cancelados antes de autorizar el envío como parte del saneamiento histórico del 17/10. Otros dos intentos detuvieron la preparación para pedir aprobación del formulario de venta del grupo; no son errores técnicos ni autorizaciones de envío.

### Destinos de grupo con más entregas no resueltas

Solo se incluyen grupo directo con `attention`, `submitted` o `pending_approval`; los alias se ordenaron por `attention`, luego `submitted`, y seudonimizaron para no publicar nombres ni URLs.

| Alias | `attention` | `submitted` | `pending_approval` |
|---|---:|---:|---:|
| G01 | 6 | 2 | 0 |
| G02 | 5 | 0 | 0 |
| G03 | 5 | 0 | 0 |
| G04 | 4 | 0 | 0 |
| G05 | 3 | 0 | 0 |
| G06 | 2 | 1 | 1 |
| G07 | 2 | 0 | 1 |
| G08 | 2 | 0 | 0 |
| G09 | 2 | 0 | 0 |
| G10 | 1 | 1 | 0 |

Los alias son locales a este informe y no permiten inferir el nombre del destino.

## Cinco casos representativos

| Caso | Mecanismo / estado | Código | Clic | Duración de referencia | Mensaje representativo | Tarea |
|---|---|---|---|---:|---|---|
| 1 | Grupo directo / `attention` | `RESULT_UNKNOWN` | Sí | Mediana del mecanismo: 16.3 s | “Resultado desconocido. Revisá la pestaña de Facebook; no se repetirá el envío.” | T3.1–T3.3 |
| 2 | Marketplace / `attention` o `submitted` | `RESULT_UNKNOWN` | Sí | Mediana del mecanismo: 22.8 s | “Resultado desconocido. Revisá la pestaña de Facebook; no se repetirá el envío.” En algunos mensajes, la observación registra `page=marketplace`, sin atribuir un resultado. | T3.1–T3.2 |
| 3 | Grupo directo / `attention` | `PREPARATION_INTERRUPTED` | No | Mediana: 12.8 s | “Verificación final antes de autorizar el envío: Cambió el orden o la carga de las fotos después de preparar. No se envió.” | T2.2 y T2.4 |
| 4 | Grupo directo / `attention` | `PREPARATION_INTERRUPTED` | No | Mediana: 54.3 s | “Preparación del grupo: Facebook no respondió a tiempo durante: cargar el editor del grupo; no se pudo determinar su disponibilidad. Verificá el resultado antes de repetir.” | T2.4 |
| 5 | Grupo directo / `attention` | `PREPARATION_INTERRUPTED` | No | Mediana: 13.0 s | `own_content_snapshot: Cannot read properties of null (reading 'startsWith')` | T2.4, con regresión de baseline nulo añadida tras T0.2 |

## Prioridades resultantes

1. Bajar los resultados desconocidos sin cambiar la política de reenvío ni convertir una candidata en éxito. La extensión debe extraer un ID nuevo; el servidor sigue comprobando baseline, autor, destino y contenido.
2. Conservar el cierre seguro en las validaciones de fotos. La IA puede ubicar controles; no puede aprobar una diferencia de fotos ni autorizar el clic final.
3. Dar tratamiento supervisado a las esperas y manejar datos opcionales nulos sin excepción. Si la lista de anuncios no está completa, debe seguir bloqueado el envío.

La falta de una versión y un mensaje inmutables por intento se cubre hacia adelante en T1.1 (`fb_run_traces.extension_version`, pasos y notas), sin reconstruir datos históricos que la base no registró.
