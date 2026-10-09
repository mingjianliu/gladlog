import { parseLine } from "../src/l1/parseLine";
import type { ParsedLine } from "../src/l1/types";
import { collectEvents } from "../src/l3/collect";
import { buildRoster } from "../src/l3/roster";
import { SWING_TWIN_WINDOW_MS, swingLandedTwins } from "../src/l3/swingTwins";

const TZ = { timezone: "UTC" } as const;
/** A line at 12:00:00 + `ms`. */
const at = (ms: number, s: string): ParsedLine => {
  const sec = String(Math.floor(ms / 1000)).padStart(2, "0");
  const frac = String(ms % 1000).padStart(3, "0");
  return parseLine(`6/30/2026 12:00:${sec}.${frac}  ${s}`, TZ)!;
};

const A = 'Player-1-A,"Alice-X",0x511,0x80000000';
const B = 'Player-2-B,"Bob-Y",0x548,0x80000000';
const GHOUL =
  'Creature-0-1-1-1-237409-0000050D66,"Lesser Ghoul",0xa28,0x80000000';
const ADV_A =
  "Player-1-A,0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70";
const ADV_B =
  "Player-2-B,0000000000000000,900,1000,0,0,0,0,0,0,0,100,100,0,1.0,-1.0,0,1.0,70";

/** amount, baseAmount, overkill, school, resisted, blocked, absorbed, crit… */
const tail = (amount: number, base: number, overkill = -1, absorbed = 0) =>
  `${amount},${base},${overkill},1,0,0,${absorbed},nil,nil,nil`;

const swing = (ms: number, src: string, t: string) =>
  at(ms, `SWING_DAMAGE,${src},${B},${ADV_A},${t}`);
const landed = (ms: number, src: string, t: string) =>
  at(ms, `SWING_DAMAGE_LANDED,${src},${B},${ADV_B},${t}`);

const collect = (records: ParsedLine[]) => {
  records.forEach((r, i) => (r.lineIndex = i));
  return collectEvents(records, buildRoster(records));
};

/** The twin LANDED records, in the order given. */
const twinsOf = (records: ParsedLine[]) => {
  const twins = swingLandedTwins(records);
  return records.filter((r) => twins.has(r));
};

describe("swingLandedTwins: which LANDED lines repeat a SWING_DAMAGE", () => {
  it("同一次平砍的两行(同来源、目标、基础伤害)是孪生行,先后顺序不限", () => {
    const s1 = swing(0, A, tail(77, 90));
    const l1 = landed(12, A, tail(77, 90));
    const l2 = landed(2000, A, tail(60, 70));
    const s2 = swing(2118, A, tail(60, 70));
    expect(twinsOf([s1, l1, l2, s2])).toEqual([l1, l2]);
  });

  it("两侧金额不同(只有受害者侧看到吸收)仍是孪生行:按基础伤害配", () => {
    const s = swing(0, A, tail(554, 773));
    const l = landed(0, A, tail(0, 773, -1, 554));
    expect(twinsOf([s, l])).toEqual([l]);
  });

  it("没有 SWING_DAMAGE 的 LANDED 行不是孪生行", () => {
    const l = landed(0, GHOUL, tail(804, 1061, 547));
    expect(swingLandedTwins([l]).size).toBe(0);
  });

  it("基础伤害不同、或相隔超过窗口,不配对", () => {
    const s = swing(0, A, tail(77, 90));
    const otherBase = landed(5, A, tail(77, 91));
    const tooLate = landed(SWING_TWIN_WINDOW_MS + 1, A, tail(77, 90));
    expect(swingLandedTwins([s, otherBase, tooLate]).size).toBe(0);
  });

  it("就近配对:远处的同值行抢不走近处的孪生行", () => {
    // An orphan LANDED, then 800 ms later a real pair with the same roll.
    const orphan = landed(0, A, tail(77, 90));
    const s = swing(800, A, tail(77, 90));
    const twin = landed(803, A, tail(77, 90));
    expect(twinsOf([orphan, s, twin])).toEqual([twin]);
  });

  it("每个孪生行映射到它自己的 SWING_DAMAGE", () => {
    const s1 = swing(0, A, tail(77, 90));
    const l1 = landed(10, A, tail(77, 90));
    const l2 = landed(20, A, tail(77, 90));
    const s2 = swing(100, A, tail(77, 90));
    const twins = swingLandedTwins([s1, l1, l2, s2]);
    expect(twins.get(l1)).toBe(s1);
    expect(twins.get(l2)).toBe(s2);
  });

  it("时间戳回退(日志顺序 ≠ 时间顺序)不漏配:两次平砍各自配上", () => {
    // codex review of FT-T01: log order SWING@0, SWING@1200, LANDED@1210,
    // LANDED@10 — a window slid over log order missed the first twin.
    const s1 = swing(0, A, tail(77, 90));
    const s2 = swing(1200, A, tail(77, 90));
    const l2 = landed(1210, A, tail(77, 90));
    const l1 = landed(10, A, tail(77, 90));
    const twins = swingLandedTwins([s1, s2, l2, l1]);
    expect(twins.get(l1)).toBe(s1);
    expect(twins.get(l2)).toBe(s2);
    const units = collect([s1, s2, l2, l1]);
    expect(units.get("Player-2-B")!.damageIn).toHaveLength(2);
  });

  it("两个候选一样近时按日志顺序取,不按时间顺序", () => {
    // codex review round 2: log order SWING@100, LANDED@110, LANDED@90 — both
    // 10 ms away; the one earlier in the LOG is the twin.
    const s = swing(100, A, tail(80, 100));
    const first = landed(110, A, tail(80, 100));
    const second = landed(90, A, tail(30, 100));
    expect(twinsOf([s, first, second])).toEqual([first]);
    const units = collect([s, first, second]);
    expect(units.get("Player-2-B")!.damageIn.map((e) => e.amount)).toEqual([
      80, 30,
    ]);
  });

  it("每条 SWING_DAMAGE 只消掉一条 LANDED", () => {
    const s = swing(0, A, tail(77, 90));
    const l1 = landed(1, A, tail(77, 90));
    const l2 = landed(2, A, tail(77, 90));
    expect(twinsOf([s, l1, l2])).toEqual([l1]);
  });
});

describe("collectEvents: a swing reaches the damage arrays exactly once (FT-T01)", () => {
  it("成对的平砍只进一次,取 SWING_DAMAGE 那一行", () => {
    const units = collect([
      swing(0, A, tail(77, 90)),
      landed(12, A, tail(77, 90)),
    ]);
    const b = units.get("Player-2-B")!;
    expect(b.damageIn.map((e) => e.eventName)).toEqual(["SWING_DAMAGE"]);
    expect(units.get("Player-1-A")!.damageOut).toHaveLength(1);
  });

  it("只有 LANDED 行的平砍进 damageIn / damageOut,致死一击带 overkill", () => {
    const units = collect([landed(0, GHOUL, tail(804, 1061, 547))]);
    const hit = units.get("Player-2-B")!.damageIn;
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({
      eventName: "SWING_DAMAGE_LANDED",
      amount: 804,
      effectiveAmount: 804 - 547,
      lineIndex: 0,
      srcId: "Creature-0-1-1-1-237409-0000050D66",
    });
    expect(
      units.get("Creature-0-1-1-1-237409-0000050D66")!.damageOut,
    ).toHaveLength(1);
  });

  it("全吸收的 LANDED 行(amount 0)不是伤害事件:吸收由 SPELL_ABSORBED 记", () => {
    const units = collect([landed(0, GHOUL, tail(0, 773, -1, 554))]);
    expect(units.get("Player-2-B")!.damageIn).toHaveLength(0);
  });

  it("LANDED 先于 SWING_DAMAGE 到达也只算一次", () => {
    const units = collect([
      landed(0, A, tail(60, 70)),
      swing(118, A, tail(60, 70)),
    ]);
    expect(units.get("Player-2-B")!.damageIn.map((e) => e.eventName)).toEqual([
      "SWING_DAMAGE",
    ]);
  });
});
