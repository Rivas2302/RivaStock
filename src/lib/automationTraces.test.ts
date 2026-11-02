import {describe,expect,it} from 'vitest';
import {traceOutcomeLabel,traceStepDecision,traceStepLabel,traceStepStatusLabel,type AutomationTraceStep} from './automationTraces';

const step:AutomationTraceStep={
  id:'step-1',trace_id:'trace-1',seq:1,step:'marketplace.category_selected',status:'supervised',elapsed_ms:1200,
  dom_summary:{ai_decision:{action:'click',index:3}},screenshot_path:null,note:'Categoría confirmada',created_at:'2026-11-02T12:00:00Z',
};

describe('automation trace presentation',()=>{
  it('translates machine step names and statuses',()=>{
    expect(traceStepLabel('marketplace.category-selected')).toBe('Marketplace category selected');
    expect(traceStepStatusLabel('supervised')).toBe('Asistido por IA');
    expect(traceOutcomeLabel('rehearsal_ok')).toBe('Ensayo completado');
    expect(traceOutcomeLabel(null)).toBe('En curso');
  });

  it('surfaces future AI supervision decisions when present in the trace summary',()=>{
    expect(traceStepDecision(step)).toEqual({action:'click',index:3});
    expect(traceStepDecision({...step,dom_summary:{}})).toBeNull();
  });
});
