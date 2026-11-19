/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t213.ts — ticket T213 (fact14 D37 / D38): Aura Mastery 31821
 * empowers the aura its paladin is running. Under Devotion Aura 465 it is
 * the 24 % team reduction `MITIGATION_TABLE` prices; under Concentration Aura
 * 317920 the press puts 317929 on the team (DB2 aura 77, silence / interrupt
 * immunity) and reduces nothing. The branch is read from the log's own rows:
 *   `concentration` — a 317929 APPLIED / REFRESH from the paladin within
 *     0.5 s of the press, on any unit;
 *   `devotion` — no such row, and the paladin's own 465 on a unit at the
 *     press (an aura row before it with no later REMOVED, or the log's start
 *     list);
 *   `switched` — a `concentration` press whose paladin's own Devotion Aura
 *     went up on it while its 31821 still ran: the product keeps it the
 *     wall, so its line must NOT state the immunity (`…:switched:stated` is
 *     the violation; `…:switched` is the count of such presses);
 *   `unseen` — neither.
 *
 *  - `auraMasteryBranchAsWall`: every press of a Holy Paladin whose second
 *    has its line. Kinds: `enemyDef:<branch>` for an `[ENEMY DEF]` line that
 *    prices it `(24%`; `friendlyCd:<branch>` for the owner's side `[CD]`
 *    press line. Only `enemyDef:concentration` is a wrong line as printed
 *    (a reduction the press did not give); the rest are the denominators
 *    and pointers, out of the total. After ruling R53 the line of an
 *    immunity-branch press states it — `Aura Mastery (silence / interrupt
 *    immunity, Ts)` on `[ENEMY DEF]`, `Aura Mastery (silence / interrupt
 *    immunity)` on our `[CD]` lines — and one that does not is the
 *    violation on both sides (`:stated` kinds are the fixed ones).
 *  - `auraMasteryBranchReadDiffers`: the product's reading of a press
 *    (`auraMasteryPressIsImmunityBranch`, the paladin's own 317929 row)
 *    against this scan's (any unit's).
 *  - `auraMasteryInAccusation` (a count, out of the total): the owner's
 *    `cd-hoarded` rows whose `readyCds` name Aura Mastery and `cd-waste`
 *    rows for it, split by whether the owner's Aura Mastery is a wall this
 *    round (`auraMasteryIsNoWallOf`).
 *  - `auraMasteryNoWallStillAWall`: per round in which every Holy Paladin's
 *    Aura Mastery is no wall (`auraMasteryIsNoWallOf`) and there is one —
 *    a line that still takes it for a wall: `popped … Aura Mastery`,
 *    `Aura Mastery in hand`, `major defensive up: … Aura Mastery`, or a
 *    percentage beside the name. Kind = which.
 *
 * The report also carries the corpus leg of the Game-Behaviour Rule, once
 * per round and press: for every teammate of the paladin, the same
 * attacker's same spell, last non-crit hit in the 4 s before the press
 * against the first in the 8 s after it — (amount + absorbed + blocked) /
 * baseAmount, after ÷ before — pooled by branch. A press that takes 24 %
 * off where Devotion Aura's own 3 % already stood reads (1 − 0.24) /
 * (1 − 0.03) = 0.784; one that reduces nothing reads 1.000. Each branch is
 * split by Holy Bulwark on the unit hit (`HOLY_BULWARK`): the first run
 * pooled them and read Devotion at 0.707 / 0.744 / 0.790.
 */
import {
  auraMasteryImmunityLabelWords,
  auraMasteryIsNoWallOf,
  auraMasteryPressIsImmunityBranch,
  auraMasteryPressSwitchedToWall,
} from "@gladlog/analysis/src/utils/auraMasteryBranch";
import { parseLine } from "@gladlog/parser";
import { CombatUnitSpec } from "@gladlog/parser-compat";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  REFRESH,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "auraMasteryBranchAsWall",
  "auraMasteryBranchReadDiffers",
  "auraMasteryNoWallStillAWall",
  "auraMasteryInAccusation",
] as const;
/** In the total: an immunity-branch press whose line does not say so
 * (`enemyDef:concentration`, `friendlyCd:concentration`), and a wall-branch
 * press whose line does (`…:devotion:stated`, `…:unseen:stated`). */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  [
    "enemyDef:devotion",
    "enemyDef:unseen",
    "friendlyCd:devotion",
    "friendlyCd:unseen",
    "enemyDef:switched:stated",
    "friendlyCd:switched:stated",
    "enemyDef:concentration:stated",
    "friendlyCd:concentration:stated",
  ]
    .map((k) => `auraMasteryBranchAsWall|${k}`)
    .concat(
      // a `cd-hoarded` row that names an immunity-only Aura Mastery as
      // ready is a violation (assembly review 80-PIPE-170-B156 #2)
      [
        "auraMasteryInAccusation|cd-hoarded:wall",
        "auraMasteryInAccusation|cd-waste:noWall",
        "auraMasteryInAccusation|cd-waste:wall",
      ],
    ),
);

const IMMUNITY_WORDS = auraMasteryImmunityLabelWords();
/** what a line says of Aura Mastery when a reader takes it for a wall */
const WALL_WORDS: ReadonlyArray<[string, RegExp]> = [
  ["popped", /popped [^|]*\bAura Mastery\b/],
  ["inHand", /\bAura Mastery in hand\b|in hand\)?[^|]*\bAura Mastery\b/],
  ["majorDefensiveUp", /major defensive up:[^\n]*\bAura Mastery\b/],
  ["pricedPct", /\bAura Mastery\b(?: \(| )\d+%/],
];

const AURA_MASTERY = "31821";
const IMMUNITY_VARIANT = "317929";
const DEVOTION_AURA = "465";
const PAIR_MS = 500;
const BEFORE_MS = 4000;
const AFTER_MS = 8000;

let ratios: Record<string, number[]> = {};

/** Holy Bulwark 432496 on the unit that is hit: DB2 row 1121230, aura 108
 * (percent), misc 3, +33 on the paladin auras' effect value (mask targets
 * 465 / 32223 / 317920) while it is up. With it the Devotion branch reads
 * (3 + 21.06) × 1.33 = 32.0 % against 3 × 1.33 = 3.99 %: 0.680 / 0.960 =
 * 0.708, where a unit without it reads 0.759 / 0.970 = 0.783. */
const HOLY_BULWARK = "432496";

/** the edge pairs of one press: per teammate, attacker and spell, with
 * whether the teammate carried Holy Bulwark at both hits (`bulwark`), at
 * neither (`plain`) or at one (`mixed`). The press is found among the raw
 * lines by its caster and ordinal, and every time is the raw lines' own
 * (one clock for the press and the hits). */
export function edgeRatios(
  ctx: Pick<IRoundCtx, "rawLines">,
  team: Set<string>,
  casterId: string,
  ordinal: number,
): Array<{ ratio: number; bulwark: "bulwark" | "plain" | "mixed" }> {
  const rows = ctx.rawLines.flatMap((line) => parseLine(line) ?? []);
  const at = rows.filter(
    (pl) =>
      pl.eventName === "SPELL_CAST_SUCCESS" &&
      pl.base?.srcGuid === casterId &&
      String(pl.spell?.spellId) === AURA_MASTERY,
  )[ordinal]?.timestamp;
  if (at === undefined) return [];
  const bulwarkUp = new Set<string>();
  const before = new Map<string, { r: number; up: boolean }>();
  const after = new Map<string, { r: number; up: boolean }>();
  for (const pl of rows) {
    if (!pl.base) continue;
    const t = pl.timestamp;
    if (t > at + AFTER_MS) break;
    if (String(pl.spell?.spellId) === HOLY_BULWARK) {
      if (pl.eventName === "SPELL_AURA_APPLIED")
        bulwarkUp.add(pl.base.destGuid);
      else if (pl.eventName === "SPELL_AURA_REMOVED")
        bulwarkUp.delete(pl.base.destGuid);
    }
    if (!pl.damage || pl.eventName === "DAMAGE_SPLIT") continue;
    if (t < at - BEFORE_MS || t === at) continue;
    if (!team.has(pl.base.destGuid) || team.has(pl.base.srcGuid)) continue;
    const d = pl.damage;
    if (d.critical || !(d.baseAmount > 0)) continue;
    const r =
      (d.amount + Math.max(d.absorbed, 0) + Math.max(d.blocked, 0)) /
      d.baseAmount;
    const k = `${pl.base.destGuid}|${pl.base.srcGuid}|${pl.spell?.spellId ?? 0}`;
    const row = { r, up: bulwarkUp.has(pl.base.destGuid) };
    if (t < at) before.set(k, row);
    else if (!after.has(k)) after.set(k, row);
  }
  const out: ReturnType<typeof edgeRatios> = [];
  for (const [k, b] of before) {
    const a = after.get(k);
    if (a !== undefined && b.r > 0)
      out.push({
        ratio: a.r / b.r,
        bulwark: a.up && b.up ? "bulwark" : a.up || b.up ? "mixed" : "plain",
      });
  }
  return out;
}

const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? NaN;
};

export function report(): string[] {
  return [
    "Aura Mastery edge pairs, after ÷ before (n; p25 / median / p75):",
    ...Object.entries(ratios)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([b, xs]) =>
          `  ${b}: ${xs.length}; ${[0.25, 0.5, 0.75].map((q) => quantile(xs, q).toFixed(3)).join(" / ")}`,
      ),
  ];
}
export const state = () => ({ ratios });
export const load = (s: ReturnType<typeof state>): void => {
  ratios = s.ratios;
};
export const merge = {
  ratios: (a: Record<string, number[]>, b: Record<string, number[]>) => {
    for (const [k, v] of Object.entries(b)) (a[k] ??= []).push(...v);
    return a;
  },
};

function startListHas(u: any, id: string): boolean {
  try {
    const l: unknown = JSON.parse(u.info?.interestingAurasJSON ?? "[]");
    return Array.isArray(l) && l.some((x) => String(x) === id);
  } catch {
    return false;
  }
}

/** is `srcId`'s aura `id` up on `u` at `ms`, by `u`'s own rows */
function auraFromUpAt(u: any, id: string, srcId: string, ms: number): boolean {
  let up = u.id === srcId && startListHas(u, id);
  for (const a of ((u.auraEvents ?? []) as any[])
    .filter((x) => String(x.spellId) === id && tsOf(x) <= ms)
    .sort((x, y) => tsOf(x) - tsOf(y))) {
    if (ev(a) === REMOVED) up = false;
    else if ((ev(a) === APPLIED || ev(a) === REFRESH) && a.srcUnitId === srcId)
      up = true;
  }
  return up;
}

export function run(ctx: IRoundCtx): void {
  const C = "auraMasteryBranchAsWall";
  if (!ctx.owner) return;
  const paladins = (ctx.players as any[]).filter(
    (u) => u.spec === CombatUnitSpec.Paladin_Holy,
  );
  const round = { startTime: ctx.start, endTime: ctx.roundEndAt };
  // menu rows that name the OWNER's Aura Mastery as a defensive held or
  // wasted (`cd-hoarded` readyCds, `cd-waste` spell): a count, by whether
  // the owner's Aura Mastery is a wall this round. R53 names the wall
  // readers; whether an immunity-branch Aura Mastery belongs in these two
  // accusations is a classification the ruling did not take.
  if (ctx.owner.spec === CombatUnitSpec.Paladin_Holy) {
    const noWall = auraMasteryIsNoWallOf(ctx.owner, round);
    for (const row of ctx.menu.split("\n")) {
      const type = /\btype=(cd-hoarded|cd-waste)\b/.exec(row)?.[1];
      if (!type) continue;
      const names =
        type === "cd-hoarded"
          ? /readyCds=[^,}]*\bAura Mastery\b/.test(row)
          : /\bspell=Aura Mastery\b/.test(row);
      if (!names) continue;
      ctx.bump("auraMasteryInAccusation");
      ctx.violate(
        "auraMasteryInAccusation",
        `${type}:${noWall ? "noWall" : "wall"}`,
        ctx.start,
        /\bid=(\S+)/.exec(row)?.[1] ?? row.slice(0, 60),
        `${ctx.owner.name}: ${type} names Aura Mastery; its Aura Mastery is ${noWall ? "no wall" : "a wall"} this round`,
        row.trim().slice(0, 300),
      );
    }
  }
  if (
    paladins.length > 0 &&
    paladins.every((u) => auraMasteryIsNoWallOf(u, round))
  ) {
    ctx.bump("auraMasteryNoWallStillAWall");
    ctx.lines.forEach((l, i) => {
      for (const [kind, re] of WALL_WORDS)
        if (re.test(l)) {
          ctx.violate(
            "auraMasteryNoWallStillAWall",
            kind,
            ctx.start,
            `${kind}:${i}`,
            `no Holy Paladin of this round has Aura Mastery as a wall`,
            l.trim().slice(0, 300),
          );
          break;
        }
    });
  }
  for (const p of ctx.players as any[]) {
    let ordinal = -1;
    for (const c of successesOf(p).sort((x, y) => tsOf(x) - tsOf(y))) {
      if (String(c.spellId) !== AURA_MASTERY) continue;
      ordinal++;
      const at = tsOf(c);
      if (at < ctx.start || at >= ctx.roundEndAt) continue;
      const immunity = (ctx.players as any[]).some((u) =>
        ((u.auraEvents ?? []) as any[]).some(
          (a) =>
            String(a.spellId) === IMMUNITY_VARIANT &&
            a.srcUnitId === p.id &&
            (ev(a) === APPLIED || ev(a) === REFRESH) &&
            Math.abs(tsOf(a) - at) <= PAIR_MS,
        ),
      );
      // the press opened in the immunity branch and the paladin's own
      // Devotion Aura went up on it while its 31821 still ran: the press
      // stays the immunity on its line and its wall starts at the switch
      // (assembly review 80-PIPE-170-B156 #1; one press on the 605 files —
      // `switched` is its count)
      // the product's own reading of the switch, not a second calculation
      // (codex 85-tk-WIN-T213-3 #5: this scan allowed 1 s more than the
      // product and counted a correctly tagged line as a violation)
      const switched = auraMasteryPressSwitchedToWall(p, at);
      // the verdict is the product's own reading of the press — one predicate
      // for the label and its check (codex 85-tk-WIN-T213-2 #5); this
      // scan's any-unit reading stays the diagnostic
      // (`auraMasteryBranchReadDiffers`)
      const productImmunity = auraMasteryPressIsImmunityBranch(p, at);
      const branch = switched
        ? "switched"
        : productImmunity
          ? "concentration"
          : (ctx.players as any[]).some((u) =>
                auraFromUpAt(u, DEVOTION_AURA, p.id, at),
              )
            ? "devotion"
            : "unseen";
      if (ctx.firstOwnerOfRound)
        for (const e of edgeRatios(
          ctx,
          new Set(
            (ctx.players as any[])
              .filter((u) => u.reaction === p.reaction)
              .map((u) => u.id as string),
          ),
          p.id,
          ordinal,
        ))
          (ratios[`${branch}, ${e.bulwark}`] ??= []).push(e.ratio);
      const second = fmtS((at - ctx.start) / 1000);
      const enemy = p.reaction !== ctx.owner.reaction;
      // the product's own reading of the press (the paladin's own row)
      // against this scan's (any unit's): one fact, two readers
      if (auraMasteryPressIsImmunityBranch(p, at) !== immunity) {
        ctx.bump("auraMasteryBranchReadDiffers");
        ctx.violate(
          "auraMasteryBranchReadDiffers",
          immunity ? "scanOnly" : "productOnly",
          at,
          `${p.id}:${second}`,
          `${p.name} pressed Aura Mastery at ${second}`,
        );
      }
      const line = ctx.lines.find(
        (l) =>
          l.startsWith(`${second} `) &&
          l.includes("Aura Mastery") &&
          (enemy
            ? l.includes("[ENEMY DEF]")
            : /\[(?:YOU|TEAM)\] \[CD\]/.test(l)),
      );
      if (!line) continue;
      ctx.bump(C);
      // ruling R53: an immunity-branch press says so on its line, both sides
      const stated = line.includes(
        enemy
          ? `Aura Mastery (${IMMUNITY_WORDS}, `
          : `Aura Mastery (${IMMUNITY_WORDS})`,
      );
      ctx.violate(
        C,
        `${enemy ? "enemyDef" : "friendlyCd"}:${branch}${stated ? ":stated" : ""}`,
        at,
        `${p.id}:${second}`,
        `${p.name} pressed Aura Mastery at ${second}, branch ${branch}`,
        line.trim().slice(0, 300),
      );
    }
  }
}
