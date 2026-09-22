import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { API_MAX_TOKENS, API_MAX_TOKENS_FLOOR } from "./aiBudgets";

describe("API max_tokens budgets (GH #92)", () => {
  it("every budget clears the floor sized for Opus 5 adaptive thinking", () => {
    for (const [name, value] of Object.entries(API_MAX_TOKENS)) {
      expect(value, name).toBeGreaterThanOrEqual(API_MAX_TOKENS_FLOOR);
    }
  });

  it("no main call site carries a numeric max_tokens literal", () => {
    const dir = __dirname;
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      if (f === "aiBudgets.ts") continue;
      const src = readFileSync(join(dir, f), "utf8");
      const m = src.match(/max_tokens:\s*\d[\d_]*/g);
      if (m) offenders.push(`${f}: ${m.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
