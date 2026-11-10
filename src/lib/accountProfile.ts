import { supabase } from './supabase';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/\s+/g, ' ');
  return EMAIL_PATTERN.test(normalized) ? '' : normalized;
}

export function validateDisplayName(value: string): string | null {
  const normalized = normalizeDisplayName(value);
  if (normalized.length < 2 || normalized.length > 80) return 'Escribí tu nombre (entre 2 y 80 caracteres).';
  return null;
}

export async function saveAccountProfile(displayName: string, password?: string): Promise<void> {
  const normalizedName = normalizeDisplayName(displayName);
  const validationError = validateDisplayName(normalizedName);
  if (validationError) throw new Error(validationError);

  const { data, error } = await supabase.auth.updateUser({
    ...(password ? { password } : {}),
    data: {
      display_name: normalizedName,
      full_name: normalizedName,
      password_set: true,
      must_change_password: false,
    },
  });
  if (error) throw new Error('No se pudo guardar tu perfil. Intentá de nuevo.');
  const userId = data.user?.id;
  if (!userId) throw new Error('No se pudo verificar la cuenta. Volvé a iniciar sesión.');

  const { error: profileError } = await supabase.from('profiles')
    .update({ display_name: normalizedName })
    .eq('id', userId);
  if (profileError) throw new Error('Se guardó la cuenta, pero no pudimos actualizar el nombre visible. Intentá guardar el perfil de nuevo.');
}
