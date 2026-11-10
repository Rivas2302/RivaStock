import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../AuthContext';
import type { BusinessPlan } from '../lib/businessPlan';

interface BusinessPlanState {
  identityKey: string | null;
  plan: BusinessPlan | null;
  loading: boolean;
  error: Error | null;
}

interface BusinessPlanContextValue {
  plan: BusinessPlan | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const EMPTY_STATE: BusinessPlanState = { identityKey: null, plan: null, loading: true, error: null };
const BusinessPlanContext = createContext<BusinessPlanContextValue | null>(null);

export function BusinessPlanProvider({ children }: { children: ReactNode }) {
  const { ownerUid, authUser, loading: authLoading } = useAuth();
  const actorUid = authUser?.uid ?? null;
  const identityKey = ownerUid && actorUid ? `${ownerUid}:${actorUid}` : null;
  const identityRef = useRef<string | null>(identityKey);
  identityRef.current = identityKey;
  const [state, setState] = useState<BusinessPlanState>(EMPTY_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const mountedRef = useRef(false);
  const requestRef = useRef<{ identityKey: string; promise: Promise<void> } | null>(null);
  const wasInactive = useRef(typeof document !== 'undefined' && document.visibilityState === 'hidden');

  const commitState = useCallback((next: BusinessPlanState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (authLoading || !ownerUid || !actorUid || !identityKey) return Promise.resolve();
    const existingRequest = requestRef.current;
    if (existingRequest?.identityKey === identityKey) return existingRequest.promise;

    const previousState = stateRef.current;
    const retainedPlan = previousState.identityKey === identityKey ? previousState.plan : null;
    commitState({ identityKey, plan: retainedPlan, loading: retainedPlan === null, error: null });

    const promise = (async () => {
      try {
        const { getBusinessPlanForOwner } = await import('../lib/businessPlan');
        const plan = await getBusinessPlanForOwner(ownerUid, true);
        if (!mountedRef.current || identityRef.current !== identityKey) return;
        commitState({ identityKey, plan, loading: false, error: null });
      } catch (cause: unknown) {
        if (!mountedRef.current || identityRef.current !== identityKey) return;
        const currentState = stateRef.current;
        const lastValidPlan = currentState.identityKey === identityKey ? currentState.plan : retainedPlan;
        if (lastValidPlan) {
          commitState({ identityKey, plan: lastValidPlan, loading: false, error: null });
          console.warn('[BusinessPlan] Background refresh failed; keeping the last verified plan.');
          return;
        }
        commitState({
          identityKey,
          plan: null,
          loading: false,
          error: cause instanceof Error ? cause : new Error('No se pudo verificar el plan del negocio.'),
        });
      }
    })();
    const request = { identityKey, promise };
    requestRef.current = request;
    void promise.finally(() => {
      if (requestRef.current === request) requestRef.current = null;
    });
    return promise;
  }, [actorUid, authLoading, commitState, identityKey, ownerUid]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (authLoading) {
      commitState({ identityKey: null, plan: null, loading: true, error: null });
      return;
    }
    if (!identityKey) {
      commitState({ identityKey: null, plan: null, loading: false, error: null });
      return;
    }
    if (stateRef.current.identityKey !== identityKey) {
      commitState({ identityKey, plan: null, loading: true, error: null });
    }
    void refresh();
  }, [authLoading, commitState, identityKey, refresh]);

  useEffect(() => {
    if (!identityKey || authLoading) return;
    const markInactive = () => { wasInactive.current = true; };
    const refreshOnReturn = () => {
      if (!wasInactive.current) return;
      wasInactive.current = false;
      void refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') markInactive();
      else refreshOnReturn();
    };

    window.addEventListener('blur', markInactive);
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', markInactive);
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [actorUid, authLoading, identityKey, ownerUid, refresh]);

  const currentPlan = state.identityKey === identityKey && !authLoading ? state.plan : null;
  useEffect(() => {
    if (!identityKey || !currentPlan?.suspensionScheduledFor || currentPlan.status === 'suspended') return;
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [currentPlan?.status, currentPlan?.suspensionScheduledFor, identityKey, refresh]);

  const isCurrentIdentity = state.identityKey === identityKey;
  const value: BusinessPlanContextValue = {
    plan: currentPlan,
    loading: authLoading || (identityKey !== null && !isCurrentIdentity) || (isCurrentIdentity && state.loading),
    error: isCurrentIdentity && !authLoading ? state.error : null,
    refresh,
  };

  return createElement(BusinessPlanContext.Provider, { value }, children);
}

export function useBusinessPlan(): BusinessPlanContextValue {
  const context = useContext(BusinessPlanContext);
  if (!context) throw new Error('useBusinessPlan must be used within a BusinessPlanProvider');
  return context;
}
