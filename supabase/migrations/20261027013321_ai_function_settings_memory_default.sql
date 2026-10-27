CREATE TABLE public.ai_function_settings (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  function_key text NOT NULL CHECK (function_key IN (
    'ai_memory_extract',
    'knowledge_organize',
    'fb_copywriting',
    'fb_supervisor_recover',
    'fb_supervisor_verify',
    'fb_photo_review'
  )),
  provider text NOT NULL CHECK (provider IN ('codex', 'claude', 'local')),
  model_id text NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 120),
  reasoning_effort text NOT NULL DEFAULT 'low'
    CHECK (reasoning_effort IN ('low', 'medium', 'high', 'xhigh')),
  escalate_provider text CHECK (escalate_provider IN ('codex', 'claude')),
  escalate_model_id text CHECK (escalate_model_id IS NULL OR char_length(escalate_model_id) BETWEEN 1 AND 120),
  escalate_reasoning_effort text
    CHECK (escalate_reasoning_effort IS NULL OR escalate_reasoning_effort IN ('low', 'medium', 'high', 'xhigh')),
  auto_escalate boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, function_key),
  CHECK ((escalate_provider IS NULL) = (escalate_model_id IS NULL)),
  CHECK (provider <> 'codex' OR model_id IN ('gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'))
);

COMMENT ON TABLE public.ai_function_settings IS
  'Per-user provider settings for AI functions. The Bridge falls back to Codex GPT-6 Luna low when a setting is absent.';

ALTER TABLE public.ai_function_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_function_settings_owner_select ON public.ai_function_settings
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = (SELECT auth.uid()) AND revoked_at IS NULL
  ));

CREATE POLICY ai_function_settings_owner_insert ON public.ai_function_settings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = (SELECT auth.uid()) AND revoked_at IS NULL
  ));

CREATE POLICY ai_function_settings_owner_update ON public.ai_function_settings
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = (SELECT auth.uid()) AND revoked_at IS NULL
  ))
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = (SELECT auth.uid()) AND revoked_at IS NULL
  ));

REVOKE ALL ON public.ai_function_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.ai_function_settings TO authenticated;
GRANT SELECT ON public.ai_function_settings TO service_role;

INSERT INTO public.ai_function_settings (user_id, function_key, provider, model_id, reasoning_effort)
SELECT users.id, defaults.function_key, 'codex', 'gpt-6-luna', defaults.reasoning_effort
FROM auth.users AS users
CROSS JOIN (VALUES
  ('ai_memory_extract', 'low'),
  ('knowledge_organize', 'low'),
  ('fb_copywriting', 'low'),
  ('fb_supervisor_recover', 'low'),
  ('fb_supervisor_verify', 'medium'),
  ('fb_photo_review', 'low')
) AS defaults(function_key, reasoning_effort)
WHERE NOT EXISTS (
  SELECT 1 FROM public.collaborators
  WHERE user_uid = users.id AND revoked_at IS NULL
)
ON CONFLICT (user_id, function_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
