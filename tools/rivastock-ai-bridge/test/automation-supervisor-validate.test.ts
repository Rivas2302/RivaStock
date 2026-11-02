import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSupervisorDecision, type SupervisorDomSummary, type SupervisorIntent } from '../src/automation/validate.ts';

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
