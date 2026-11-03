import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSupervisorOutput, validateSupervisedResultAssessment, validateSupervisorDecision, validateWarningClassification, type SupervisorDomSummary, type SupervisorIntent } from '../src/automation/validate.ts';

const dom: SupervisorDomSummary = {
  scope: 'dialog',
  controls: [
    { index: 0, role: 'button', name: 'Continuar', state: { disabled: false } },
    { index: 1, role: 'input', name: 'Título', type: 'text', state: { disabled: false } },
    { index: 2, role: 'combobox', name: 'Categoría', state: { disabled: false } },
    { index: 3, role: 'button', name: 'Publicar', state: { disabled: false } },
    { index: 4, role: 'button', name: 'Volver', state: { disabled: true } },
  ],
};
const base = { confidence: 0.9, observation: 'Se ve el formulario.', reason: 'Coincide con el paso.' };
const intent: SupervisorIntent = { target: { element_index: 1, role: 'input', name: 'Título' } };

test('accepts only scoped, enabled, closed-menu decisions', () => {
  assert.equal(validateSupervisorDecision({ ...base, action: 'click', element_index: 0 }, dom, {}), true);
  assert.equal(validateSupervisorDecision({ ...base, action: 'type', element_index: 1, text: 'Mesa' }, dom, intent), true);
  assert.equal(validateSupervisorDecision({ ...base, action: 'select_option', element_index: 2, text: 'Electrónica' }, dom, { target: { element_index: 2, role: 'combobox', name: 'Categoría' } }), true);
  assert.equal(validateSupervisorDecision({ ...base, action: 'wait', wait_ms: 500 }, dom, {}), true);
  assert.equal(validateSupervisorDecision({ ...base, action: 'abort' }, dom, {}), true);
});

test('rejects publish, unscoped, disabled, unlisted and field-target violations', () => {
  assert.equal(validateSupervisorDecision({ ...base, action: 'click', element_index: 3 }, dom, {}), false);
  assert.equal(validateSupervisorDecision({ ...base, action: 'click', element_index: 4 }, dom, {}), false);
  assert.equal(validateSupervisorDecision({ ...base, action: 'click', element_index: 99 }, dom, {}), false);
  assert.equal(validateSupervisorDecision({ ...base, action: 'launch', element_index: 0 }, dom, {}), false);
  assert.equal(validateSupervisorDecision({ ...base, action: 'type', element_index: 0, text: 'X' }, dom, intent), false);
  assert.equal(validateSupervisorDecision({ ...base, action: 'type', element_index: 1, text: 'X', extra: true }, dom, intent), false);
  assert.equal(validateSupervisorDecision({ ...base, action: 'type', element_index: 1, text: 'X'.repeat(201) }, dom, intent), false);
  assert.equal(validateSupervisorDecision({ ...base, action: 'click', element_index: 0 }, { ...dom, scope: 'page' }, {}), false);
  assert.equal(validateSupervisorDecision({ ...base, action: 'click', element_index: 0, confidence: 0.59 }, dom, {}), false);
  assert.equal(validateSupervisorDecision({ ...base, action: 'reload', wait_ms: 500 }, dom, {}), false);
  assert.equal(validateSupervisorDecision({ ...base, action: 'wait', wait_ms: 10001 }, dom, {}), false);
});

const resultDom: SupervisorDomSummary = {
  scope: 'page',
  controls: [{ index: 0, role: 'article', name: 'Publicación 1', text: 'Perfume floral',
    links: ['https://www.facebook.com/marketplace/item/123456789/'] }],
};
const resultAssessment = {
  found: true, element_index: 0, state: 'published', observation: 'La tarjeta coincide con el título.', confidence: 0.92,
};

test('accepts only evidence-linked verify_result assessments and never accepts invented IDs or URLs', () => {
  assert.equal(validateSupervisedResultAssessment(resultAssessment, resultDom), true);
  assert.deepEqual(parseSupervisorOutput(JSON.stringify(resultAssessment), resultDom, {}, 'verify_result'), { decision: resultAssessment });
  assert.equal(validateSupervisedResultAssessment({ ...resultAssessment, element_index: 1 }, resultDom), false);
  assert.equal(validateSupervisedResultAssessment({ ...resultAssessment, url: 'https://www.facebook.com/marketplace/item/123' }, resultDom), false);
  assert.equal(validateSupervisedResultAssessment({ found: false, element_index: 0, state: 'unknown', observation: 'No se ve.', confidence: 0.1 }, resultDom), false);
  assert.equal(validateSupervisorDecision(resultAssessment, resultDom, {}), false);
});

test('accepts only a strict warning classification with consistent category', () => {
  const safe = { warning: false, category: 'none', observation: 'No visible warning.', confidence: 0.95 };
  const warning = { warning: true, category: 'restriction', observation: 'Visible restriction notice.', confidence: 0.99 };
  assert.equal(validateWarningClassification(safe), true);
  assert.deepEqual(parseSupervisorOutput(JSON.stringify(warning), resultDom, {}, 'classify_warning'), { decision: warning });
  assert.equal(validateWarningClassification({ ...safe, warning: true }), false);
  assert.equal(validateWarningClassification({ ...warning, category: 'none' }), false);
  assert.equal(validateWarningClassification({ ...warning, extra: 'publish now' }), false);
  assert.equal(validateWarningClassification({ ...warning, confidence: Number.NaN }), false);
  assert.equal(validateWarningClassification({ ...warning, observation: ' '.repeat(2) }), false);
  assert.deepEqual(parseSupervisorOutput('not json', resultDom, {}, 'classify_warning'), { error: 'La respuesta no era un objeto JSON válido.' });
});
