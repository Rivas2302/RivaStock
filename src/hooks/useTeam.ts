import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fromDb } from '../lib/db';
import type { Collaborator, Invitation } from '../types';

export function useTeam() {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [invitations,   setInvitations]   = useState<Invitation[]>([]);
  const [loading,       setLoading]       = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const [{ data: collabs }, { data: invs }] = await Promise.all([
      supabase.rpc('list_collaborators'),
      supabase.rpc('list_invitations'),
    ]);
    setCollaborators((collabs ?? []).map(r => fromDb<Collaborator>(r)));
    setInvitations((invs ?? []).map(r => fromDb<Invitation>(r)));
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { collaborators, invitations, loading, refetch };
}
