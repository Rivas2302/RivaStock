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
    try {
      const [{ data: collabs, error: e1 }, { data: invs, error: e2 }] = await Promise.all([
        supabase.rpc('list_collaborators'),
        supabase.rpc('list_invitations'),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setCollaborators((collabs ?? []).map(r => fromDb<Collaborator>(r)));
      setInvitations((invs ?? []).map(r => fromDb<Invitation>(r)));
    } catch (err) {
      console.error('[useTeam] refetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { collaborators, invitations, loading, refetch };
}
