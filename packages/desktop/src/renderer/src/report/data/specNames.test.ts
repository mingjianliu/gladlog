import { describe, expect, test } from "vitest";

import { specIconName } from "./gameConstants";
import { SPEC_ID_BY_EN, SPEC_NAMES_ZH } from "./specNames";

describe("specNames 一致性", () => {
  test("两表键集一致,specId 全部有图标", () => {
    expect(Object.keys(SPEC_ID_BY_EN).sort()).toEqual(
      Object.keys(SPEC_NAMES_ZH).sort(),
    );
    // The icon source moved from external CDN slugs to icon base names generated
    // from Blizzard's DB2 (specIconsGenerated); this still guards "every namable
    // spec has an icon".
    for (const [en, id] of Object.entries(SPEC_ID_BY_EN)) {
      expect(specIconName(id), `${en} → ${id}`).toBeTruthy();
    }
  });
});
