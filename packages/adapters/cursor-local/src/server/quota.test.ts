import { describe, expect, it } from "vitest";
import { mapCursorBillingResponse } from "./quota.js";

describe("Cursor billing quota mapper", () => {
  it("maps dashboard-style fast_remaining and slow_remaining fields", () => {
    const windows = mapCursorBillingResponse({
      fast_remaining: 42,
      fast_limit: 100,
      slow_remaining: 900,
      slow_limit: 1000,
    });

    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({
      label: "Fast requests",
      usedPercent: 58,
      remainingPercent: 42,
      remainingValue: 42,
      limitValue: 100,
      unit: "requests",
    });
    expect(windows[1]).toMatchObject({
      label: "Slow requests",
      usedPercent: 10,
      remainingPercent: 90,
      remainingValue: 900,
      limitValue: 1000,
      unit: "requests",
    });
  });

  it("maps nested billing responses without requiring hardcoded plan limits", () => {
    const windows = mapCursorBillingResponse({
      usage: {
        fastRemaining: "7",
        slowRemaining: "88",
      },
    });

    expect(windows.map((window) => window.valueLabel)).toEqual([
      "7 remaining",
      "88 remaining",
    ]);
    expect(windows.every((window) => window.usedPercent == null)).toBe(true);
  });
});
