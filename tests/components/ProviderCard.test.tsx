import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types";
import { ProviderCard } from "@/components/providers/ProviderCard";

const providerActionsSpy = vi.fn();

vi.mock("@/components/providers/ProviderActions", () => ({
  ProviderActions: (props: unknown) => {
    providerActionsSpy(props);
    return <div data-testid="provider-actions" />;
  },
}));

vi.mock("@/components/ProviderIcon", () => ({
  ProviderIcon: () => <div data-testid="provider-icon" />,
}));

vi.mock("@/components/UsageFooter", () => ({
  default: () => <div data-testid="usage-footer" />,
}));

vi.mock("@/components/SubscriptionQuotaFooter", () => ({
  default: () => <div data-testid="subscription-footer" />,
}));

vi.mock("@/components/CopilotQuotaFooter", () => ({
  default: () => <div data-testid="copilot-footer" />,
}));

vi.mock("@/components/CodexOauthQuotaFooter", () => ({
  default: () => <div data-testid="codex-oauth-footer" />,
}));

vi.mock("@/lib/query/failover", () => ({
  useProviderHealth: () => ({ data: null }),
}));

vi.mock("@/lib/query/queries", () => ({
  useUsageQuery: () => ({ data: null }),
}));

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: overrides.id ?? "provider-1",
    name: overrides.name ?? "Test Provider",
    settingsConfig: overrides.settingsConfig ?? {},
    category: overrides.category,
    createdAt: overrides.createdAt,
    sortIndex: overrides.sortIndex,
    meta: overrides.meta,
    websiteUrl: overrides.websiteUrl,
  };
}

describe("ProviderCard", () => {
  it("keeps one-click test available for Claude providers that were previously filtered", () => {
    providerActionsSpy.mockClear();

    const handleTest = vi.fn();
    render(
      <ProviderCard
        provider={createProvider({
          category: "third_party",
          meta: { providerType: "github_copilot" },
        })}
        isCurrent={false}
        appId="claude"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onConfigureUsage={vi.fn()}
        onOpenWebsite={vi.fn()}
        onDuplicate={vi.fn()}
        onTest={handleTest}
        isProxyRunning={false}
      />,
    );

    expect(screen.getByTestId("provider-actions")).toBeInTheDocument();
    expect(providerActionsSpy).toHaveBeenCalled();
    expect(providerActionsSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      onTest: expect.any(Function),
    });
  });
});
