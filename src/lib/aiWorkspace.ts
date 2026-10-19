import { supabase } from './supabase';

export interface AIWorkspaceFile {
  id: string;
  user_id: string;
  path: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const WORKSPACE_PATH_PATTERN = /^(skills|knowledge)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:md|txt|json|yaml|yml|toml)$/i;

export async function listAIWorkspaceFiles(): Promise<AIWorkspaceFile[]> {
  const { data, error } = await supabase.from('ai_workspace_files')
    .select('id, user_id, path, content, created_at, updated_at')
    .order('path', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AIWorkspaceFile[];
}

export async function saveAIWorkspaceFile(
  userId: string,
  id: string | null,
  path: string,
  content: string,
): Promise<AIWorkspaceFile> {
  if (!WORKSPACE_PATH_PATTERN.test(path)) {
    throw new Error('Usá una ruta dentro de skills/ o knowledge/ y un archivo .md, .txt, .json, .yaml, .yml o .toml.');
  }
  if (content.length > 65_536) throw new Error('El archivo supera el máximo de 65.536 caracteres.');

  const query = id
    ? supabase.from('ai_workspace_files').update({ path, content }).eq('id', id)
    : supabase.from('ai_workspace_files').insert({ user_id: userId, path, content });
  const { data, error } = await query.select('id, user_id, path, content, created_at, updated_at').single();
  if (error) throw new Error(error.message);
  return data as AIWorkspaceFile;
}

export async function deleteAIWorkspaceFile(id: string): Promise<void> {
  const { error } = await supabase.from('ai_workspace_files').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export function workspaceFilePathError(path: string): string | null {
  if (!WORKSPACE_PATH_PATTERN.test(path)) {
    return 'La ruta debe empezar con skills/ o knowledge/ y usar una extensión de texto permitida.';
  }
  return null;
}
