import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import type { BusinessPlan } from '../lib/businessPlan';

interface BusinessPlanState {
  identityKey: string | null;
  plan: BusinessPlan | null;
  loading: boolean;
  error: Error | null;
}

export function useBusinessPlan() {
  const { ownerUid, authUser, loading: authLoading } = useAuth();
  const identityKey = ownerUid && authUser?.uid ? `${ownerUid}:${authUser.uid}` : null;
  const [state, setState] = useState<BusinessPlanState>({
    identityKey: null,
    plan: null,
    loading: true,
    error: null,
  });
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (authLoading) {
      setState({ identityKey: null, plan: null, loading: true, error: null });
      return;
    }
    if (!ownerUid || !authUser?.uid) {
      setState({ identityKey: null, plan: null, loading: false, error: null });
      return;
    }

    let active = true;
    const requestKey = `${ownerUid}:${authUser.uid}`;
    setState({ identityKey: requestKey, plan: null, loading: true, error: null });
    void import('../lib/businessPlan')
      .then(({ getBusinessPlanForOwner }) => getBusinessPlanForOwner(ownerUid))
      .then((plan) => {
        if (active) setState({ identityKey: requestKey, plan, loading: false, error: null });
      })
      .catch((cause: unknown) => {
        if (active) {
          setState({
            identityKey: requestKey,
            plan: null,
            loading: false,
            error: cause instanceof Error ? cause : new Error('No se pudo verificar el plan del negocio.'),
          });
        }
      });

    return () => { active = false; };
  }, [authLoading, authUser?.uid, ownerUid, refreshToken]);

  const refresh = useCallback(async () => {
    const { invalidateBusinessPlan } = await import('../lib/businessPlan');
    invalidateBusinessPlan(ownerUid ?? undefined);
    setRefreshToken((token) => token + 1);
  }, [ownerUid]);

  const isCurrentIdentity = state.identityKey === identityKey;
  return {
    plan: isCurrentIdentity && !authLoading ? state.plan : null,
    loading: authLoading || (identityKey !== null && !isCurrentIdentity) || (isCurrentIdentity && state.loading),
    error: isCurrentIdentity && !authLoading ? state.error : null,
    refresh,
  };
}
