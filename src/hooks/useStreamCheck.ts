import { useCallback, useSyncExternalStore } from "react";
import {
  streamCheckProvider,
  type StreamCheckResult,
} from "@/lib/api/model-test";
import type { AppId } from "@/lib/api";
import { useResetCircuitBreaker } from "@/lib/query/failover";

type ProviderTestTarget = {
  id: string;
  name: string;
};

type StreamCheckState = {
  checkingIds: Set<string>;
  isCheckingAll: boolean;
  results: Record<string, StreamCheckResult>;
};

const states = new Map<string, StreamCheckState>();
const listeners = new Set<() => void>();

function getState(appId: AppId): StreamCheckState {
  const key = String(appId);
  const existing = states.get(key);
  if (existing) return existing;

  const initial: StreamCheckState = {
    checkingIds: new Set(),
    isCheckingAll: false,
    results: {},
  };
  states.set(key, initial);
  return initial;
}

function updateState(
  appId: AppId,
  updater: (current: StreamCheckState) => StreamCheckState,
) {
  states.set(String(appId), updater(getState(appId)));
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStreamCheck(appId: AppId) {
  const resetCircuitBreaker = useResetCircuitBreaker();
  const state = useSyncExternalStore(
    subscribe,
    () => getState(appId),
    () => getState(appId),
  );

  const resetIfReachable = useCallback(
    (providerId: string, result: StreamCheckResult) => {
      if (result.status === "operational" || result.status === "degraded") {
        resetCircuitBreaker.mutate({ providerId, appType: appId });
      }
    },
    [appId, resetCircuitBreaker],
  );

  const clearProviderResult = useCallback(
    (providerId: string) => {
      updateState(appId, (current) => {
        const nextResults = { ...current.results };
        delete nextResults[providerId];
        return { ...current, results: nextResults };
      });
    },
    [appId],
  );

  const clearAllResults = useCallback(() => {
    updateState(appId, (current) => ({ ...current, results: {} }));
  }, [appId]);

  const checkProvider = useCallback(
    async (
      providerId: string,
      providerName: string,
    ): Promise<StreamCheckResult | null> => {
      updateState(appId, (current) => ({
        ...current,
        checkingIds: new Set(current.checkingIds).add(providerId),
        results: Object.fromEntries(
          Object.entries(current.results).filter(([id]) => id !== providerId),
        ),
      }));

      try {
        const result = await streamCheckProvider(appId, providerId);
        resetIfReachable(providerId, result);
        updateState(appId, (current) => ({
          ...current,
          results: { ...current.results, [providerId]: result },
        }));
        return result;
      } catch (error) {
        console.warn("[StreamCheck] Failed to check provider", {
          appId,
          providerId,
          providerName,
          error,
        });
        return null;
      } finally {
        updateState(appId, (current) => {
          const checkingIds = new Set(current.checkingIds);
          checkingIds.delete(providerId);
          return { ...current, checkingIds };
        });
      }
    },
    [appId, resetIfReachable],
  );

  const checkProviders = useCallback(
    async (
      targets: ProviderTestTarget[],
    ): Promise<Record<string, StreamCheckResult>> => {
      if (targets.length === 0) return {};

      updateState(appId, (current) => ({
        ...current,
        isCheckingAll: true,
        results: {},
        checkingIds: new Set([
          ...Array.from(current.checkingIds),
          ...targets.map((target) => target.id),
        ]),
      }));

      const entries = await Promise.all(
        targets.map(async (target) => {
          const result = await checkProvider(target.id, target.name);
          return result ? ([target.id, result] as const) : null;
        }),
      );

      updateState(appId, (current) => ({
        ...current,
        isCheckingAll: false,
      }));

      return Object.fromEntries(entries.filter((entry) => entry !== null));
    },
    [appId, checkProvider],
  );

  const isChecking = useCallback(
    (providerId: string) => state.checkingIds.has(providerId),
    [state.checkingIds],
  );

  return {
    checkProvider,
    checkProviders,
    clearProviderResult,
    clearAllResults,
    isChecking,
    isCheckingAll: state.isCheckingAll,
    streamCheckResults: state.results,
  };
}
