import { describe, expect, it } from "vitest";
import {
  getUsageRangePresetLabel,
  resolveUsageRange,
} from "@/lib/usageRange";

describe("usageRange", () => {
  it("resolves the branch-specific 90 day preset", () => {
    const nowMs = new Date(2026, 4, 18, 18, 30, 0).getTime();
    const resolved = resolveUsageRange({ preset: "90d" }, nowMs);

    expect(resolved.endDate).toBe(Math.floor(nowMs / 1000));
    expect(resolved.startDate).toBe(
      Math.floor(new Date(2026, 1, 18, 0, 0, 0).getTime() / 1000),
    );
  });

  it("labels the branch-specific 90 day preset", () => {
    expect(
      getUsageRangePresetLabel(
        "90d",
        (_key, options) => options?.defaultValue ?? "",
      ),
    ).toBe("90d");
  });

  it("keeps the branch-specific all-time preset", () => {
    const nowMs = new Date(2026, 4, 18, 18, 30, 0).getTime();
    const resolved = resolveUsageRange({ preset: "all" }, nowMs);

    expect(resolved.endDate).toBe(Math.floor(nowMs / 1000));
    expect(resolved.startDate).toBe(0);
    expect(
      getUsageRangePresetLabel(
        "all",
        (_key, options) => options?.defaultValue ?? "",
      ),
    ).toBe("All");
  });
});
