# Servicio de recuperación de Conocimientos

Conocimientos ofrece dos interfaces separadas por entorno. Las consultas del navegador respetan la sesión y los filtros de la cuenta; el Bridge local solo recibe fragmentos mediante una acción de worker que valida la reserva de la tarea.

## Navegador

```ts
searchKnowledge({
  query: string,
  filters?: {
    document_ids?: string[];
    category_ids?: string[];
    folder_ids?: string[];
    tag_ids?: string[];
  },
  topK?: number,
  mode: 'auto' | 'keyword',
}) => Promise<{ mode: 'semantic' | 'keyword'; notice?: string | null; results: KnowledgeChunkResult[] }>
```

La implementación está en `src/lib/knowledge/service.ts`. El modo `auto` usa búsqueda semántica cuando el Bridge está disponible y conserva el fallback por palabras clave; `keyword` fuerza la búsqueda textual. `KnowledgeChunkResult` incluye documento, versión, sección y páginas para mostrar la procedencia.

## Worker y agentes

`retrieveForJob` y `buildKnowledgeContext` están en `tools/rivastock-ai-bridge/src/knowledge/retrieval.ts`. El Bridge llama `worker_retrieve` en `supabase/functions/knowledge` con la tarea, el embedding, la consulta y el modelo. La función valida el token del worker y la base vuelve a comprobar que la tarea siga reservada por esa PC y sea `text_generation`.

Las nuevas capacidades deben agregar una acción validada a la Edge Function `knowledge`. No expongas `knowledge_match_chunks` directamente al navegador ni al worker. Un error de recuperación se registra y la generación continúa sin fuentes.

## Garantías y límites

- La consulta queda acotada a la cuenta propietaria del Bridge y a tareas reservadas por su dispositivo activo.
- Solo se recuperan fragmentos de la versión publicada, habilitada e indexada del documento.
- Cada fuente conserva etiqueta, documento, versión, sección y páginas cuando existen.
- El contenido recuperado se presenta como dato de referencia no confiable; sus delimitadores se neutralizan y la IA recibe instrucciones explícitas para no obedecer texto incrustado.
- Conocimientos no es la fuente de precios, stock ni catálogo. Esos datos deben venir de `products` y del contexto comercial estructurado de `worker_context`.
- El contexto se consulta con el mensaje actual, no con todo el historial del chat. Los seguimientos breves pueden recuperar menos información.

## Integraciones futuras

Estas integraciones están previstas, no implementadas:

- Skills podrán declarar filtros de categorías y etiquetas en `knowledge_filters` de su frontmatter.
- Automatización de publicaciones podrá consultar documentos de producto etiquetados `producto:<nombre>`.
- El asistente técnico podrá filtrar las categorías “Manuales” y “Procedimientos”.
- El cotizador IA podrá combinar la categoría “Compatibilidad” con datos estructurados de `products`.
