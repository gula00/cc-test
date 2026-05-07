import {
  hasDuplicateCustomModelKey,
  type CustomModelItem,
} from "@/components/providers/forms/OmoFormFields";

describe("hasDuplicateCustomModelKey", () => {
  const builtinKeys = new Set(["main", "writer"]);

  it("returns true when the key conflicts with a builtin key", () => {
    const customs: CustomModelItem[] = [{ key: "custom-a", model: "model-a" }];

    expect(
      hasDuplicateCustomModelKey("writer", builtinKeys, customs, 0),
    ).toBe(true);
  });

  it("returns true when the key conflicts with another custom key", () => {
    const customs: CustomModelItem[] = [
      { key: "custom-a", model: "model-a" },
      { key: "custom-b", model: "model-b" },
    ];

    expect(
      hasDuplicateCustomModelKey("custom-b", builtinKeys, customs, 0),
    ).toBe(true);
  });

  it("ignores the current row when checking duplicates", () => {
    const customs: CustomModelItem[] = [
      { key: "custom-a", model: "model-a" },
      { key: "custom-b", model: "model-b" },
    ];

    expect(
      hasDuplicateCustomModelKey("custom-a", builtinKeys, customs, 0),
    ).toBe(false);
  });

  it("compares trimmed keys", () => {
    const customs: CustomModelItem[] = [
      { key: "custom-a", model: "model-a" },
      { key: " custom-b ", model: "model-b" },
    ];

    expect(
      hasDuplicateCustomModelKey("custom-b", builtinKeys, customs, 0),
    ).toBe(true);
  });
});
