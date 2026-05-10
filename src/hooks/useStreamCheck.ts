import { useCallback, useState } from "react";
import {
  streamCheckAllProviders,
  streamCheckProvider,
  type StreamCheckResult,
} from "@/lib/api/model-test";
import type { AppId } from "@/lib/api";
import { useResetCircuitBreaker } from "@/lib/query/failover";

export function useStreamCheck(appId: AppId) {
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const resetCircuitBreaker = useResetCircuitBreaker();

  const resetIfReachable = useCallback(
    (providerId: string, result: StreamCheckResult) => {
      if (result.status === "operational" || result.status === "degraded") {
        resetCircuitBreaker.mutate({ providerId, appType: appId });
      }
    },
    [appId, resetCircuitBreaker],
  );

  const checkProvider = useCallback(
    async (
      providerId: string,
      providerName: string,
    ): Promise<StreamCheckResult | null> => {
      setCheckingIds((prev) => new Set(prev).add(providerId));

      try {
        const result = await streamCheckProvider(appId, providerId);
        resetIfReachable(providerId, result);
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
        setCheckingIds((prev) => {
          const next = new Set(prev);
          next.delete(providerId);
          return next;
        });
      }
    },
    [appId, resetIfReachable],
  );

  const isChecking = useCallback(
    (providerId: string) => checkingIds.has(providerId),
    [checkingIds],
  );

  const checkAllProviders = useCallback(async (): Promise<
    Record<string, StreamCheckResult>
  > => {
    setIsCheckingAll(true);

    try {
      const entries = await streamCheckAllProviders(appId);
      const nextResults = Object.fromEntries(entries);

      for (const [providerId, result] of entries) {
        resetIfReachable(providerId, result);
      }

      return nextResults;
    } catch (error) {
      console.warn("[StreamCheck] Failed to check all providers", {
        appId,
        error,
      });
      return {};
    } finally {
      setIsCheckingAll(false);
      setCheckingIds(new Set());
    }
  }, [appId, resetIfReachable]);

  return { checkProvider, checkAllProviders, isChecking, isCheckingAll };
}
