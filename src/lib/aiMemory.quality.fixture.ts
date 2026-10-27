export const AI_MEMORY_GOLDEN_DATASET_VERSION = 'memory-quality-v1';

export const PINNED_PREFERENCE = {
  key: 'preference-style',
  kind: 'preference' as const,
  content: 'Synthetic preference: keep answers concise and define abbreviations.',
  embeddingIndex: 25,
};

export const FACT_MEMORIES = Array.from({ length: 15 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0');
  return {
    key: 'fact-' + number,
    kind: 'fact' as const,
    content: 'Synthetic fact ' + number + ': package F' + number + ' uses rack R' + number + '.',
    embeddingIndex: index,
  };
});

export const SUMMARY_MEMORIES = Array.from({ length: 10 }, (_, index) => {
  const number = String(index + 16).padStart(2, '0');
  return {
    key: 'summary-' + number,
    kind: 'summary' as const,
    content: 'Synthetic conversation ' + number + ': option S' + number + ' was selected for the fixture.',
    embeddingIndex: index + 15,
  };
});

export const RELEVANT_QUERIES = [
  ...FACT_MEMORIES.map((memory, index) => ({
    id: 'fact-query-' + String(index + 1).padStart(2, '0'),
    kind: 'fact' as const,
    expectedMemoryKey: memory.key,
    embeddingIndex: memory.embeddingIndex,
    query: 'Which rack is assigned to synthetic package F' + String(index + 1).padStart(2, '0') + '?',
  })),
  ...SUMMARY_MEMORIES.map((memory, index) => ({
    id: 'summary-query-' + String(index + 1).padStart(2, '0'),
    kind: 'summary' as const,
    expectedMemoryKey: memory.key,
    embeddingIndex: memory.embeddingIndex,
    query: 'What option was selected in synthetic conversation S' + String(index + 16).padStart(2, '0') + '?',
  })),
  ...[
    'What concise response style is preferred?',
    'How should an abbreviation be explained?',
    'Which answer format preference is saved?',
    'What general writing preference should be followed?',
    'How should responses handle unfamiliar abbreviations?',
  ].map((query, index) => ({
    id: 'preference-query-' + String(index + 1).padStart(2, '0'),
    kind: 'preference' as const,
    expectedMemoryKey: PINNED_PREFERENCE.key,
    embeddingIndex: PINNED_PREFERENCE.embeddingIndex,
    query,
  })),
];

export const NO_MATCH_QUERIES = Array.from({ length: 10 }, (_, index) => ({
  id: 'no-match-' + String(index + 1).padStart(2, '0'),
  query: 'Unrelated synthetic control topic Z' + String(index + 1).padStart(2, '0') + '?',
  embeddingIndex: index + 26,
}));

export const CORRECTION_FORGET_CASES = [
  { id: 'update-01', action: 'update' as const, command: 'Recordá que el paquete fixture C01 ahora usa rack R02.', before: 'Synthetic correction C01: rack R01.', after: 'Synthetic correction C01: rack R02.', embeddingIndex: 40 },
  { id: 'update-02', action: 'update' as const, command: 'Acordate de que la ruta sintética C02 cambió a C02-B.', before: 'Synthetic correction C02: route C02-A.', after: 'Synthetic correction C02: route C02-B.', embeddingIndex: 41 },
  { id: 'update-03', action: 'update' as const, command: 'Anotá que el lote de prueba C03 cambió de estado.', before: 'Synthetic correction C03: state pending.', after: 'Synthetic correction C03: state ready.', embeddingIndex: 42 },
  { id: 'update-04', action: 'update' as const, command: 'Guardá en memoria que el código sintético C04 ahora es C04-B.', before: 'Synthetic correction C04: code C04-A.', after: 'Synthetic correction C04: code C04-B.', embeddingIndex: 43 },
  { id: 'update-05', action: 'update' as const, command: 'No te olvides de que la etiqueta sintética C05 ahora dice verde.', before: 'Synthetic correction C05: label blue.', after: 'Synthetic correction C05: label green.', embeddingIndex: 44 },
  { id: 'forget-06', action: 'archive' as const, command: 'Olvidá el dato sintético C06.', before: 'Synthetic correction C06: value six.', after: null, embeddingIndex: 45 },
  { id: 'forget-07', action: 'archive' as const, command: 'Olvidate de la ruta de ensayo C07.', before: 'Synthetic correction C07: route seven.', after: null, embeddingIndex: 46 },
  { id: 'forget-08', action: 'archive' as const, command: 'Borrá de la memoria el valor sintético C08.', before: 'Synthetic correction C08: value eight.', after: null, embeddingIndex: 47 },
  { id: 'forget-09', action: 'archive' as const, command: 'El dato C09 ya no sirve; olvidá el recuerdo anterior.', before: 'Synthetic correction C09: old fixture value.', after: null, embeddingIndex: 48 },
  { id: 'forget-10', action: 'archive' as const, command: 'Olvidá el recuerdo de prueba C10.', before: 'Synthetic correction C10: old fixture value.', after: null, embeddingIndex: 49 },
];

export const SENSITIVE_EXAMPLES = [
  'Mi contraseña es fixture-pass-01.',
  'API key: fixture-key-01',
  'Token de acceso fixture-token-01',
  'CBU 1234567890123456789012',
  'CVU 2234567890123456789012',
  'IBAN AR1234567890123456789012',
  'Tarjeta de crédito 4111 1111 1111 1111',
  'DNI 12345678',
  'Código de verificación 123456',
  'Diagnóstico de salud: fixture condition',
  'Mi clave bancaria es fixture-bank-secret',
] as const;
