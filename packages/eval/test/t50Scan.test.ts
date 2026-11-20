/**
 * scan5/t50 (pipeline T50): which window lines the check reads, and the
 * clause it takes from them.
 */
import { describe, expect, it } from "vitest";

import { LINE_RE } from "../scripts/scan5/t50";

const line = (clause: string) =>
  `  [KILL WINDOW] 2:01–2:08 on Devourer Demon Hunter (Unit-Realm): team offensive CDs ready at 2:01: none; enemy healer hard-CC'd in window; ${clause}; you cast no CC; your damage on it 0k; free 7s of 7s, team min HP 56%.`;

describe("scan5/t50 killWindowCcBack", () => {
  it("读 `your CC on cooldown` 的窗口行,带不带回来从句都读", () => {
    const bare = LINE_RE.exec(line("your CC on cooldown"))!;
    expect([bare[1], bare[2], bare[3]]).toEqual(["2:01", "2:08", undefined]);
    const back = LINE_RE.exec(
      line("your CC on cooldown (back inside: Hammer of Justice 2:02)"),
    )!;
    expect(back[3]).toBe(" (back inside: Hammer of Justice 2:02)");
    const two = LINE_RE.exec(
      line(
        "your CC on cooldown (back inside: Hammer of Justice 2:02、Blinding Light 2:06)",
      ),
    )!;
    expect(two[3]).toBe(
      " (back inside: Hammer of Justice 2:02、Blinding Light 2:06)",
    );
  });

  it("[VULNERABLE] 行同样读;`your CC ready` 的行不读", () => {
    expect(
      LINE_RE.exec(
        "  [VULNERABLE] 0:40–0:52 (12s) on Arcane Mage (Unit-Realm): no major defensives, never punished (team damage 8k total); team offensive CDs ready at 0:40: none; your CC on cooldown; you cast no CC; your damage on it 0k; free 12s of 12s.",
      )?.[1],
    ).toBe("0:40");
    expect(LINE_RE.exec(line("your CC ready: Hammer of Justice"))).toBeNull();
    expect(LINE_RE.exec(line("CC ready"))).toBeNull();
  });
});
