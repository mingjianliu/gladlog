/**
 * T167's ` (back inside: …)` clause after `your CC on cooldown` must not hide
 * a kill-window line from the scans that parse it (batch review
 * 80-PIPE-202-B184: scan5/t163 killWindowReadyGrid skipped every line with
 * the clause; scan5/effectEnd wallHeldPastHold took the clause as the kill
 * target).
 */
import { describe, expect, it } from "vitest";

import { KILL_WINDOW_ON } from "../scripts/scan5/effectEnd";
import { READY_LINE_RE } from "../scripts/scan5/t163";

const line = (header: string, clause: string) =>
  `  [KILL WINDOW] ${header} on Holy Priest (Krevs-Proudmoore-US): team burst 215k; team offensive CDs ready at 2:25: none; enemy healer hard-CC'd in window; ${clause}; you cast no CC; your damage on it 0k; free 14s of 14s, team min HP 41%; target defenseless 2:13–2:47.`;

describe("kill-window parsers read T167's back-inside clause", () => {
  it("t163 READY_LINE_RE 读带不带回来从句的 `your CC on cooldown`,就绪列表照旧", () => {
    const bare = READY_LINE_RE.exec(line("2:25–2:39", "your CC on cooldown"))!;
    expect([bare[1], bare[2]]).toEqual(["2:25", "your CC on cooldown"]);
    const back = READY_LINE_RE.exec(
      line(
        "2:25–2:39",
        "your CC on cooldown (back inside: Hammer of Justice 2:31、Blinding Light 2:28)",
      ),
    )!;
    expect([back[1], back[2]]).toEqual(["2:25", "your CC on cooldown"]);
    const ready = READY_LINE_RE.exec(
      line(
        "2:25–2:39",
        "your CC ready: Psychic Scream (enemy healer DR: Full), Holy Word: Chastise (enemy healer DR: Full)",
      ),
    )!;
    expect(ready[2]).toBe(
      "your CC ready: Psychic Scream (enemy healer DR: Full), Holy Word: Chastise (enemy healer DR: Full)",
    );
  });

  it("effectEnd KILL_WINDOW_ON 的目标取窗口头里的名字,不取回来从句", () => {
    for (const clause of [
      "your CC on cooldown",
      "your CC on cooldown (back inside: Hammer of Justice 2:31、Blinding Light 2:28)",
    ]) {
      const m = KILL_WINDOW_ON.exec(line("2:25–2:39", clause))!;
      expect([m[1], m[2], m[3]]).toEqual([
        "Krevs-Proudmoore-US",
        "2:13",
        "2:47",
      ]);
    }
    const vuln = KILL_WINDOW_ON.exec(
      line(
        "2:25–2:39",
        "your CC on cooldown (back inside: Hammer of Justice 2:31)",
      ).replace("[KILL WINDOW] 2:25–2:39", "[VULNERABLE] 2:25–2:39 (14s)"),
    )!;
    expect(vuln[1]).toBe("Krevs-Proudmoore-US");
  });
});
