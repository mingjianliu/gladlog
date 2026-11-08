import { describe, expect, it } from "vitest";

import { checkChannelInterruptedFadeExpired } from "../src/quality/promptQualityCheck";

/**
 * GH #173.3 (pipeline T19, 605 121-1-679): the press line says the channel
 * was interrupted, the fade line in its end second may not say "(expired)".
 */
const press =
  "0:22  [YOU] [CD]   Dark Harvest (interrupted at 1.6s, ended 0:23) (self: 100% HP, +4%/s, 73k DPS) | dampening: 10%";
const fade = (note: string, at = "0:23") =>
  `${at}  [BUFF FADED]   Dark Harvest (${note})`;

describe("checkChannelInterruptedFadeExpired (GH #173.3)", () => {
  it("fails the 605 shape; the stopped reading passes", () => {
    expect(
      checkChannelInterruptedFadeExpired([press, fade("expired")]),
    ).toHaveLength(1);
    expect(
      checkChannelInterruptedFadeExpired([
        press,
        fade("ended after 1.6 of 2s — the channel stopped"),
      ]),
    ).toEqual([]);
  });

  it("a role tag between name and suffix is read", () => {
    const hymn =
      "1:41  [YOU] [CD]   Divine Hymn [HEALING CD] (interrupted at 2.7s, ended 1:44) (team; lowest ally 69% HP)";
    expect(
      checkChannelInterruptedFadeExpired([
        hymn,
        "1:44  [BUFF FADED]   Divine Hymn (expired)",
      ]),
    ).toHaveLength(1);
  });

  it("controls: a completed channel, another second, another spell, an aura tail", () => {
    const done = press.replace("interrupted at 1.6s", "channeled 1.6s");
    expect(checkChannelInterruptedFadeExpired([done, fade("expired")])).toEqual(
      [],
    );
    expect(
      checkChannelInterruptedFadeExpired([press, fade("expired", "0:41")]),
    ).toEqual([]);
    expect(
      checkChannelInterruptedFadeExpired([
        press,
        "0:23  [BUFF FADED]   Divine Hymn (expired)",
      ]),
    ).toEqual([]);
    const tail =
      "0:17  [YOU] [CD]   Ultimate Penitence (interrupted at 4.8s, ended 0:22; its aura until 0:23) → 6(DWarlock)";
    expect(
      checkChannelInterruptedFadeExpired([
        tail,
        "0:23  [BUFF FADED]   Ultimate Penitence (expired)",
      ]),
    ).toEqual([]);
  });
});
