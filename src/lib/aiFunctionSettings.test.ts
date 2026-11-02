import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAIFunctionSetting, getAIFunctionSettings, saveAIFunctionSetting } from './aiFunctionSettings';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  upsert: vi.fn(),
  single: vi.fn(),
}));

vi.mock('./supabase', () => ({ supabase: { from: mocks.from } }));

describe('AI function settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({
      select: mocks.select,
      eq: mocks.eq,
      upsert: mocks.upsert,
      single: mocks.single,
    });
    mocks.select.mockReturnValue({ eq: mocks.eq, single: mocks.single });
    mocks.upsert.mockReturnValue({ select: mocks.select });
  });

  it('fills missing function rows with the documented defaults', async () => {
    mocks.eq.mockResolvedValue({ data: [{ function_key: 'fb_supervisor_verify', provider: 'codex', model_id: 'gpt-6.1-sol', reasoning_effort: 'high' }], error: null });

    const settings = await getAIFunctionSettings('owner-1');

    expect(settings).toHaveLength(6);
    expect(settings.find((setting) => setting.function_key === 'knowledge_organize')).toEqual(
      defaultAIFunctionSetting('owner-1', 'knowledge_organize'),
    );
    expect(settings.find((setting) => setting.function_key === 'fb_supervisor_verify')).toMatchObject({
      provider: 'codex', model_id: 'gpt-6.1-sol', reasoning_effort: 'high',
    });
    expect(mocks.from).toHaveBeenCalledWith('ai_function_settings');
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'owner-1');
  });

  it('uses the default if a stored Codex model is unsupported', async () => {
    mocks.eq.mockResolvedValue({ data: [{ function_key: 'fb_copywriting', provider: 'codex', model_id: 'unknown', reasoning_effort: 'xhigh' }], error: null });

    const settings = await getAIFunctionSettings('owner-1');
    expect(settings.find((setting) => setting.function_key === 'fb_copywriting')).toEqual({
      ...defaultAIFunctionSetting('owner-1', 'fb_copywriting'), reasoning_effort: 'xhigh',
    });
  });

  it('upserts only validated owner settings and returns the saved row', async () => {
    mocks.single.mockResolvedValue({
      data: { function_key: 'knowledge_organize', provider: 'codex', model_id: 'gpt-6.1-sol', reasoning_effort: 'medium' }, error: null,
    });
    const setting = { ...defaultAIFunctionSetting('owner-1', 'knowledge_organize'), model_id: 'gpt-6.1-sol', reasoning_effort: 'medium' as const };

    await expect(saveAIFunctionSetting(setting)).resolves.toMatchObject(setting);
    expect(mocks.upsert).toHaveBeenCalledWith(setting, { onConflict: 'user_id,function_key' });
    await expect(saveAIFunctionSetting({ ...setting, model_id: 'not-a-codex-model' })).rejects.toThrow('Elegí un modelo de Codex válido.');
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
});
