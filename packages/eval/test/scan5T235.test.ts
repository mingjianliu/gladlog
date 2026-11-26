/**
 * scan5/t235 (T300, codex 80-WSL-BW1-1 #4): the names of a FAILED text's
 * `saved by external (…)` clause, as the check compares them with the
 * attempt's externals.
 */
import { describe, expect, it } from "vitest";

import { printedExternalNames } from "../scripts/scan5/t235";

describe("scan5/t235 printedExternalNames", () => {
  it("没有该子句时为 undefined", () => {
    expect(printedExternalNames("target trinketed out")).toBeUndefined();
    expect(
      printedExternalNames("broke out (Blink); forced a full immunity"),
    ).toBeUndefined();
  });

  it("读出一个或多个名字,去掉 [up since m:ss]", () => {
    expect(
      printedExternalNames(
        "target trinketed out; saved by external (Pain Suppression)",
      ),
    ).toEqual(["Pain Suppression"]);
    expect(
      printedExternalNames(
        "broke out (Will to Survive); saved by external (Blessing of Sacrifice [up since 1:57]/Ironbark)",
      ),
    ).toEqual(["Blessing of Sacrifice", "Ironbark"]);
  });

  it("子句后面还有别的子句时只读到它自己的右括号", () => {
    expect(
      printedExternalNames(
        "target trinketed out; saved by external (Aura Mastery); self-saved (Nature's Guardian)",
      ),
    ).toEqual(["Aura Mastery"]);
  });

  it("空子句读成空列表(检查把它算作不符)", () => {
    expect(
      printedExternalNames("target trinketed out; saved by external ()"),
    ).toEqual([]);
  });
});
