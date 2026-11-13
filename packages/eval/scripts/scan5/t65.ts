/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents) */
/**
 * scan5/t65.ts — pipeline T65: nine recorded items that had no occasion in
 * the 20 audited rounds, each counted once on the 605 capture — how often
 * its precondition occurs, and how many of those the product reads wrong.
 * Kinds named `occasion: …` are the precondition alone and stay out of the
 * check's total; every other kind is a line or fact the log contradicts.
 *
 *  - `syncVariantEnd` (GH #167 item 28): `syncWindowCdFor` keys a press's
 *    observed end on the ledger row's own id. Counted: every press of a
 *    team-burst cooldown. Occasion: the press has no observed end while the
 *    cooldown timeline lists a press in that ms under another id (an
 *    override variant). Wrong: for such a press, a healer lock it would
 *    enter on the observed end and not on the official length, or the
 *    reverse (`castEntersWindow`'s `activeIn`, the press outside the lead).
 *  - `deathSetupUsable` (GH #147 item 16): a death-setup `healer-locked`
 *    row. Occasion: the healer held a ready cooldown usable under control
 *    (the three `USABLE_WHILE_*` tables, any control) at the lock's start.
 *    Wrong: the healer pressed one of those spells inside a control the row
 *    counts as locked.
 *  - `enemyTrinketSelfCc` (GH #143 item 5): an `[ENEMY TRINKET]` line.
 *    Occasion: a control the presser's own cast put on itself (a reflect)
 *    is on it in that second. Wrong: the line then names no control.
 *  - `feignNoTactics` (GH #173 item 34): a player's `unconscious=1` row (a
 *    Feign Death). Occasion: no Survival Tactics 202748 went up on the unit
 *    within 1 s. Wrong: the feigner is the owner's enemy and the second has
 *    no `[ENEMY DEF]` line naming Feign Death.
 *  - `mdWindowLedger` (GH #159 item 2): an `md-cyclone-window` row. Wrong:
 *    the cooldown ledger has the owner's Mass Dispel down at the window's
 *    start, or has an immunity the row calls `still down` back at the row's
 *    second.
 *  - `writeStall` (GH #167 item 25), once per round: Occasion: no log row
 *    for ≥ 1.5 s inside the round, then ≥ 150 rows within 0.5 s. Occasion
 *    (second kind): such a catch-up burst holds a control's REMOVED row.
 *  - `envMistInvoke` (GH #123 item 16), once per round: an Enveloping Mist
 *    124682 whose last application the log shows (APPLIED or REFRESH, read
 *    on the rows) fell inside its monk's Invoke Chi-Ji / Yu'lon window.
 *    Wrong (T84): that run was left without a REMOVED row and the builder,
 *    given the casters, cut it short of the plain length + the window's
 *    4 s from that application with the round still running. Occasions:
 *    such a run the cap or the round's end closed at its full length; one
 *    the monk's next application closed; a Gift of the Celestials holder's
 *    (the +4 s is not priced for them).
 *  - `survivalSet4` (GH #175 item 9), once per round: a Survival Hunter.
 *    Occasion: it wears 4 pieces of set 2059 (Mongoose Fury's bonus, which
 *    no product reader prices).
 *  - `timewalkerCap` (GH #179 item 25), once per round: a run of an aura on
 *    Timewalker's mask (`TIMEWALKER_LENGTHENED_IDS`) cast by an
 *    Augmentation Evoker. Occasion: its logged life ran past the official
 *    length. Wrong: the run was left without a REMOVED row, its end the
 *    official-length cap.
 */
import {
  countsAsTeamBurst,
  enemyHealerCcWindows,
  mergeHealerCcWindows,
  SYNC_ENTER_LEAD_S,
  syncWindowCdFor,
  timelinePressMsOf,
} from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { setPiecesWorn } from "@gladlog/analysis/src/data/classSetBonuses";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import { dropAuraRebroadcasts } from "@gladlog/analysis/src/utils/auraRebroadcast";
import {
  buffFullDurationForCaster,
  TIMEWALKER_LENGTHENED_IDS,
} from "@gladlog/analysis/src/utils/buffDuration";
import {
  cdAvailableAt,
  extractMajorCooldowns,
  unitCooldownEntry,
  USABLE_WHILE_CC_SPELL_IDS,
  USABLE_WHILE_CONFUSED_SPELL_IDS,
  USABLE_WHILE_FEARED_SPELL_IDS,
} from "@gladlog/analysis/src/utils/cooldowns";
import { reconstructEnemyCDTimeline } from "@gladlog/analysis/src/utils/enemyCDs";
import { talentModifierOwnershipOf } from "@gladlog/analysis/src/utils/talentOwnership";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "syncVariantEnd",
  "deathSetupUsable",
  "enemyTrinketSelfCc",
  "feignNoTactics",
  "mdWindowLedger",
  "writeStall",
  "envMistInvoke",
  "survivalSet4",
  "timewalkerCap",
] as const;

const OCC_SYNC_VARIANT = "occasion: press on the timeline under another id";
const OCC_SYNC_NONE = "occasion: no timeline press in the ms";
const PRESS_PAIR_MS = 1500;
const OCC_USABLE_READY = "occasion: usable-under-control cooldown ready";
const OCC_SELF_CC_NAMED = "occasion: self-sourced control, line names one";
const OCC_FEIGN_FRIENDLY = "occasion: friendly feign without the aura";
const OCC_STALL = "occasion: write stall";
const OCC_STALL_CC = "occasion: stall's catch-up holds a control REMOVED";
const OCC_SET4 = "occasion: wears 4 pieces of set 2059";
const OCC_TW_LONG = "occasion: ran past the official length";
const OCC_ENV_CAPPED =
  "occasion: left without REMOVED: the cap carries the window's +4 s, or the round ended first";
const OCC_ENV_REPLACED =
  "occasion: left without REMOVED: closed by the monk's next application";
const OCC_ENV_GIFT =
  "occasion: Gift of the Celestials holder (or unreadable talents), not lengthened";

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `syncVariantEnd|${OCC_SYNC_VARIANT}`,
  `syncVariantEnd|${OCC_SYNC_NONE}`,
  `deathSetupUsable|${OCC_USABLE_READY}`,
  `enemyTrinketSelfCc|${OCC_SELF_CC_NAMED}`,
  `feignNoTactics|${OCC_FEIGN_FRIENDLY}`,
  `writeStall|${OCC_STALL}`,
  `writeStall|${OCC_STALL_CC}`,
  `survivalSet4|${OCC_SET4}`,
  `timewalkerCap|${OCC_TW_LONG}`,
  `envMistInvoke|${OCC_ENV_CAPPED}`,
  `envMistInvoke|${OCC_ENV_GIFT}`,
  `envMistInvoke|${OCC_ENV_REPLACED}`,
]);

export function run(ctx: IRoundCtx): void {
  if (ctx.owner) {
    syncVariantEnd(ctx);
    deathSetupUsable(ctx);
    enemyTrinketSelfCc(ctx);
    feignNoTactics(ctx);
    mdWindowLedger(ctx);
  }
  if (ctx.firstOwnerOfRound) {
    writeStall(ctx);
    envMistInvoke(ctx);
    survivalSet4(ctx);
    timewalkerCap(ctx);
  }
}

const combatOf = (ctx: IRoundCtx) => ({
  startTime: ctx.start,
  endTime: ctx.end,
  units: ctx.legacy.units,
});
/** a fact of a menu row — read inside `facts={…}`: the row's own `t=66s`
 * ahead of it is not the fact `t=66` */
const factOf = (row: string, key: string): string | undefined => {
  const at = row.indexOf("facts={");
  return at < 0
    ? undefined
    : new RegExp(`[{ ]${key}=([^,}]*)`).exec(row.slice(at + 6))?.[1];
};

// ── GH #167 item 28 ────────────────────────────────────────────────────────
function syncVariantEnd(ctx: IRoundCtx): void {
  const friends = (ctx.players as any[]).filter(
    (u) => u.reaction === ctx.owner.reaction,
  );
  const enemies = (ctx.players as any[]).filter(
    (u) => u.reaction !== ctx.owner.reaction,
  );
  const enemyIds = new Set<string>(enemies.map((u) => u.id));
  const enemyAndPetIds = new Set<string>([
    ...enemyIds,
    ...(ctx.units as any[])
      .filter((u) => u.ownerId && enemyIds.has(u.ownerId))
      .map((u) => u.id as string),
  ]);
  let windows: Array<{ fromSeconds: number; toSeconds: number }> = [];
  try {
    windows = mergeHealerCcWindows(
      enemyHealerCcWindows(friends, enemies, ctx.legacy),
    );
  } catch {
    windows = [];
  }
  for (const f of friends) {
    let cds: any[] = [];
    let timeline: any[] = [];
    try {
      cds = extractMajorCooldowns(f, ctx.legacy).filter((cd: any) =>
        countsAsTeamBurst(f, String(cd.spellId)),
      );
      if (cds.length)
        timeline = [
          ...(reconstructEnemyCDTimeline([f], ctx.legacy).players[0]
            ?.offensiveCDs ?? []),
        ];
    } catch {
      continue;
    }
    for (const cd of cds) {
      const scd: any = syncWindowCdFor(
        { ...cd, ownerName: f.name },
        f,
        enemies,
        enemyAndPetIds,
        ctx.start,
        ctx.units,
        ctx.legacy,
      );
      if (!scd.castEndS) continue;
      for (const c of cd.casts as Array<{ timeSeconds: number }>) {
        ctx.bump("syncVariantEnd");
        const key = Math.round(c.timeSeconds * 1000);
        // what the consumer finds for this press (`timelinePressMsOf`)
        if (timelinePressMsOf(scd, c.timeSeconds) !== undefined) continue;
        // the timeline's press of it, read here on its own: the nearest
        // row within 1.5 s — the ledger stamps an activation at its aura,
        // the timeline at its cast row (codex 85-tk-H-T65-1 #2: an
        // exact-ms join filed the miss under "no timeline press")
        const other = timeline
          .map((p) => ({
            p,
            d: Math.abs(Math.round(p.castTimeSeconds * 1000) - key),
          }))
          // off the exact ms only a row of the cooldown's own name
          .filter(
            (x) =>
              x.d === 0 ||
              (x.d <= PRESS_PAIR_MS &&
                nameOf(x.p.spellId, x.p.spellName) ===
                  nameOf(cd.spellId, cd.spellName)),
          )
          .sort((x, y) => x.d - y.d)[0]?.p;
        const id = `${f.name}:${String(cd.spellId)}:${key}`;
        const where = `${f.name}: ${cd.spellName} ${String(cd.spellId)} pressed at ${fmtS(c.timeSeconds)}`;
        if (!other) {
          ctx.violate(
            "syncVariantEnd",
            OCC_SYNC_NONE,
            ctx.start + key,
            id,
            where,
          );
          continue;
        }
        ctx.violate(
          "syncVariantEnd",
          OCC_SYNC_VARIANT,
          ctx.start + key,
          id,
          `${where}; the timeline has it as ${String(other.spellId)}, ending ${other.buffEndSeconds.toFixed(1)}s`,
        );
        const official =
          c.timeSeconds +
          (buffFullDurationForCaster(String(cd.spellId), f) ?? 0);
        const w = windows.find(
          (x) =>
            c.timeSeconds < x.fromSeconds - SYNC_ENTER_LEAD_S &&
            other.buffEndSeconds > x.fromSeconds !== official > x.fromSeconds,
        );
        if (w)
          ctx.violate(
            "syncVariantEnd",
            "a healer lock entered on one end and not the other",
            ctx.start + key,
            id,
            `${where}: observed end ${other.buffEndSeconds.toFixed(1)}s, official ${official.toFixed(1)}s, healer lock from ${w.fromSeconds.toFixed(1)}s`,
          );
      }
    }
  }
}

// ── GH #147 item 16 ────────────────────────────────────────────────────────
const usableUnderControl = (id: string): boolean =>
  USABLE_WHILE_CC_SPELL_IDS.has(id) ||
  USABLE_WHILE_FEARED_SPELL_IDS.has(id) ||
  USABLE_WHILE_CONFUSED_SPELL_IDS.has(id);

function deathSetupUsable(ctx: IRoundCtx): void {
  for (const row of ctx.menu.split("\n")) {
    if (!row.includes("type=death-setup") || !row.includes("lockedS="))
      continue;
    if (factOf(row, "kind") !== "healer-locked") continue;
    const healer = ctx.byName.get(factOf(row, "healer") ?? "");
    const chain = /chain=(.*?), chainFrom=/.exec(row)?.[1];
    const fromS = Number(factOf(row, "chainFrom"));
    if (!healer || !chain || !Number.isFinite(fromS)) continue;
    ctx.bump("deathSetupUsable");
    // the controls the row counts (a root locks no cast)
    const spans = chain
      .split("; ")
      .filter((e) => !e.includes("(root)"))
      .map((e) => /^(.*?) (\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(e.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ name: m[1]!, from: Number(m[2]), to: Number(m[3]) }));
    const id = `${healer.name}:${fromS}`;
    let ready: string[] = [];
    try {
      ready = extractMajorCooldowns(healer, ctx.legacy)
        .filter(
          (cd: any) =>
            usableUnderControl(String(cd.spellId)) &&
            cdAvailableAt(cd, Math.floor(fromS)),
        )
        .map((cd: any) => String(cd.spellName));
    } catch {
      ready = [];
    }
    if (ready.length)
      ctx.violate(
        "deathSetupUsable",
        OCC_USABLE_READY,
        ctx.start + fromS * 1000,
        id,
        `${healer.name}: ${ready.join(" / ")} ready at ${fromS}s; chain ${chain}`,
        row.trim().slice(0, 200),
      );
    const pressed = successesOf(healer).filter((c) => {
      const s = (tsOf(c) - ctx.start) / 1000;
      return (
        usableUnderControl(String(c.spellId)) &&
        spans.some((x) => s > x.from && s < x.to)
      );
    });
    if (pressed.length)
      ctx.violate(
        "deathSetupUsable",
        "healer pressed a usable-under-control spell inside the lock",
        tsOf(pressed[0]),
        id,
        `${healer.name}: ${pressed
          .map(
            (c) =>
              `${nameOf(c.spellId, c.spellName ?? "")} at ${((tsOf(c) - ctx.start) / 1000).toFixed(1)}s`,
          )
          .join(", ")}; chain ${chain}`,
        row.trim().slice(0, 200),
      );
  }
}

// ── GH #143 item 5 ─────────────────────────────────────────────────────────
const ENEMY_TRINKET = /^(\d+:\d\d)\s+\[ENEMY TRINKET\]\s+(\d+)\([^)]*\) used /;

function enemyTrinketSelfCc(ctx: IRoundCtx): void {
  const combat = combatOf(ctx);
  for (const l of ctx.lines) {
    const m = ENEMY_TRINKET.exec(l);
    if (!m) continue;
    const u = ctx.unitOfPid(m[2]);
    if (!u) continue;
    ctx.bump("enemyTrinketSelfCc");
    const s = secOf(m[1]!);
    const self = buildAuraIntervals(u, combat as any).filter(
      (iv) =>
        iv.srcUnitId === u.id &&
        ccSpellIds.has(iv.spellId) &&
        iv.fromS < s + 1 &&
        iv.toS > s,
    );
    if (self.length === 0) continue;
    const named = l.includes(" out of ");
    ctx.violate(
      "enemyTrinketSelfCc",
      named ? OCC_SELF_CC_NAMED : "self-sourced control, line names none",
      ctx.start + s * 1000,
      `${u.name}:${s}`,
      `${u.name} at ${m[1]}: its own ${self.map((iv) => nameOf(iv.spellId, iv.spellName)).join(" / ")} on it`,
      l.trim().slice(0, 200),
    );
  }
}

// ── GH #173 item 34 ────────────────────────────────────────────────────────
const SURVIVAL_TACTICS = "202748";

function feignNoTactics(ctx: IRoundCtx): void {
  for (const u of ctx.players as any[]) {
    for (const r of (u.unconsciousRecords ?? []) as any[]) {
      const ms = r.timestamp as number;
      if (ms < ctx.start || ms > ctx.roundEndAt) continue;
      ctx.bump("feignNoTactics");
      const aura = ((u.auraEvents ?? []) as any[]).some(
        (a) =>
          a.spellId === SURVIVAL_TACTICS &&
          ev(a) === APPLIED &&
          Math.abs(tsOf(a) - ms) <= 1000,
      );
      if (aura) continue;
      const s = Math.floor((ms - ctx.start) / 1000);
      const id = `${u.name}:${ms}`;
      const where = `${u.name} feigned at ${fmtS(s)} with no Survival Tactics aura`;
      if (u.reaction === ctx.owner.reaction) {
        ctx.violate("feignNoTactics", OCC_FEIGN_FRIENDLY, ms, id, where);
        continue;
      }
      const pid = ctx.pidOf(u.name);
      const line = ctx.lines.some((l) => {
        const t = /^(\d+:\d\d)\s+\[ENEMY DEF\]\s+(\d+)\(/.exec(l);
        return (
          !!t &&
          t[2] === pid &&
          Math.abs(secOf(t[1]!) - s) <= 1 &&
          l.includes("Feign Death")
        );
      });
      if (line) continue;
      ctx.violate(
        "feignNoTactics",
        "enemy feign without the aura: no [ENEMY DEF] line",
        ms,
        id,
        where,
      );
    }
  }
}

// ── GH #159 item 2 ─────────────────────────────────────────────────────────
const MASS_DISPEL = "32375";

function mdWindowLedger(ctx: IRoundCtx): void {
  for (const row of ctx.menu.split("\n")) {
    if (!row.includes("type=md-cyclone-window")) continue;
    const t = Number(factOf(row, "t"));
    const fromT = Number(factOf(row, "windowFromT"));
    if (!Number.isFinite(t) || !Number.isFinite(fromT)) continue;
    ctx.bump("mdWindowLedger");
    const id = `${ctx.ownerName}:${t}`;
    try {
      const md = unitCooldownEntry(ctx.owner, ctx.legacy, MASS_DISPEL);
      if (md && !cdAvailableAt(md, fromT))
        ctx.violate(
          "mdWindowLedger",
          "Mass Dispel down on the ledger at the window's start",
          ctx.start + fromT * 1000,
          id,
          `window from ${fromT}s; Mass Dispel pressed at ${md.casts.map((c) => c.timeSeconds.toFixed(0)).join(", ")}s`,
          row.trim().slice(0, 240),
        );
    } catch {
      /* no ledger for the owner: nothing to compare */
    }
    const imm = /strategicImmunities=([^}]*)/.exec(row)?.[1] ?? "";
    for (const part of imm.split("; ")) {
      const m = /^(.+)'s (.+?) spent at (\d+)s, still down/.exec(part.trim());
      if (!m) continue;
      const holder = ctx.byName.get(m[1]!);
      if (!holder) continue;
      let back = false;
      try {
        const cd = extractMajorCooldowns(holder, ctx.legacy).find(
          (x: any) => x.spellName === m[2],
        );
        back = !!cd && cdAvailableAt(cd, t);
      } catch {
        back = false;
      }
      if (back)
        ctx.violate(
          "mdWindowLedger",
          "immunity still down on the row, back on the ledger",
          ctx.start + t * 1000,
          `${id}:${m[2]}`,
          `${m[2]} spent at ${m[3]}s reads back at ${t}s on the ledger`,
          row.trim().slice(0, 240),
        );
    }
  }
}

// ── GH #167 item 25 ────────────────────────────────────────────────────────
const STALL_GAP_MS = 1500;
const CATCH_UP_ROWS = 150;
const CATCH_UP_MS = 500;
const RAW_TIME = /^\d+\/\d+(?:\/\d+)? (\d+):(\d\d):(\d\d)\.(\d+)/;

function writeStall(ctx: IRoundCtx): void {
  ctx.bump("writeStall");
  // ms of day, in log order; a round does not span two midnights
  const rows: Array<{ ms: number; line: string }> = [];
  let dayShift = 0;
  let prev = -1;
  for (const line of ctx.rawLines) {
    const m = RAW_TIME.exec(line);
    if (!m) continue;
    const frac = Number(`0.${m[4]}`) * 1000;
    let ms =
      (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 +
      frac +
      dayShift;
    if (prev >= 0 && ms < prev - 12 * 3600 * 1000) {
      dayShift += 24 * 3600 * 1000;
      ms += 24 * 3600 * 1000;
    }
    prev = ms;
    rows.push({ ms, line });
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.ms - rows[i - 1]!.ms < STALL_GAP_MS) continue;
    let j = i;
    while (j < rows.length && rows[j]!.ms - rows[i]!.ms <= CATCH_UP_MS) j++;
    if (j - i < CATCH_UP_ROWS) continue;
    const at = ctx.start + (rows[i]!.ms - rows[0]!.ms);
    const id = `${ctx.roundKey}:${i}`;
    ctx.violate(
      "writeStall",
      OCC_STALL,
      at,
      id,
      `${((rows[i]!.ms - rows[i - 1]!.ms) / 1000).toFixed(2)}s without a row, then ${j - i} rows in ${CATCH_UP_MS} ms`,
    );
    const ccRemoved = rows.slice(i, j).filter(({ line }) => {
      const f = line.split(",");
      return f[0]!.endsWith("SPELL_AURA_REMOVED") && ccSpellIds.has(f[9] ?? "");
    }).length;
    if (ccRemoved)
      ctx.violate(
        "writeStall",
        OCC_STALL_CC,
        at,
        id,
        `${ccRemoved} control REMOVED row(s) in the catch-up burst`,
      );
  }
}

// ── GH #123 item 16 ────────────────────────────────────────────────────────
const ENVELOPING_MIST = "124682";
const INVOKES = ["325197", "322118"];
const INVOKE_WINDOW_MS = 25_000;
const DOSE = "SPELL_AURA_APPLIED_DOSE";
const ENV_MIST_WINDOW_ADD_S = 4;
const GIFT_OF_THE_CELESTIALS = "388212";

function envMistInvoke(ctx: IRoundCtx): void {
  const combat = combatOf(ctx);
  // the product's builder with the casters in hand, as its readers call it:
  // the official-length cap is the caster's (T84)
  const castersById = new Map<string, any>(
    (ctx.players as any[]).map((p) => [p.id, p]),
  );
  const endS = (ctx.end - ctx.start) / 1000;
  for (const u of ctx.units as any[]) {
    if (!u.auraEvents?.length) continue;
    for (const iv of buildAuraIntervals(u, combat as any, castersById)) {
      if (iv.spellId !== ENVELOPING_MIST) continue;
      const monk = (ctx.players as any[]).find((p) => p.id === iv.srcUnitId);
      if (!monk) continue;
      const fromMs = ctx.start + iv.fromS * 1000;
      const toMs = ctx.start + iv.toS * 1000;
      // the monk's rows of the aura on this unit, read on the log — not the
      // builder's interval: the cap runs from the run's LAST application
      // (APPLIED or REFRESH), and the window is asked of that instant
      // (codex 85-tk-G-T84-1 #2: a run applied at 34 s and refreshed at
      // 36 s, past the window, closed rightly at 43 s and read as cut)
      // The builder's own normalisation first: a REMOVED + APPLIED
      // re-broadcast pair is no row (`dropAuraRebroadcasts`), and an APPLIED
      // inside the interval is one the builder read as a re-broadcast too —
      // it would have split the interval there otherwise — so only a
      // REFRESH / DOSE inside moves the anchor (codex 85-tk-G-T84-1b: a
      // re-broadcast at 16 s of a run applied at 12 s read as cut at 23 s)
      const own = dropAuraRebroadcasts((u.auraEvents ?? []) as any[]).filter(
        (a: any) =>
          String(a.spellId) === ENVELOPING_MIST && a.srcUnitId === monk.id,
      );
      const anchorMs = own
        .filter(
          (a: any) =>
            (ev(a) === REFRESH || ev(a) === DOSE) &&
            tsOf(a) > fromMs &&
            tsOf(a) < toMs - 1,
        )
        .reduce((m: number, a: any) => Math.max(m, tsOf(a)), fromMs);
      // the window is the monk's own press of the celestial, for as long as
      // THAT monk's lasts (Gift of the Celestials: 12 s, not 25)
      const inside = successesOf(monk).some((c) => {
        if (!INVOKES.includes(String(c.spellId))) return false;
        const windowS =
          buffFullDurationForCaster(String(c.spellId), monk) ??
          INVOKE_WINDOW_MS / 1000;
        return anchorMs >= tsOf(c) && anchorMs <= tsOf(c) + windowS * 1000;
      });
      if (!inside) continue;
      ctx.bump("envMistInvoke");
      if (!iv.inferredEnd) continue;
      const id = `${monk.name}:${u.name}:${iv.fromS.toFixed(3)}`;
      const where = `${monk.name}'s Enveloping Mist on ${u.name} ${iv.fromS.toFixed(1)}–${iv.toS.toFixed(1)}s`;
      // closed by the monk's next application of it (a recast whose REMOVED
      // the log lost), not by the cap: nothing to measure (codex #3)
      if (own.some((a) => ev(a) === APPLIED && Math.abs(tsOf(a) - toMs) <= 1)) {
        ctx.violate("envMistInvoke", OCC_ENV_REPLACED, fromMs, id, where);
        continue;
      }
      // the plain length with no application time: what the cap was before
      // the window's +4 s
      const plain = buffFullDurationForCaster(ENVELOPING_MIST, monk);
      const cutShort =
        plain !== undefined &&
        (toMs - anchorMs) / 1000 < plain + ENV_MIST_WINDOW_ADD_S - 0.05 &&
        iv.toS < endS - 0.05;
      ctx.violate(
        "envMistInvoke",
        !cutShort
          ? OCC_ENV_CAPPED
          : talentModifierOwnershipOf(monk, GIFT_OF_THE_CELESTIALS) !== "no"
            ? OCC_ENV_GIFT
            : "left without REMOVED: cut without the window's +4 s",
        fromMs,
        id,
        where,
      );
    }
  }
}

// ── GH #175 item 9 ─────────────────────────────────────────────────────────
function survivalSet4(ctx: IRoundCtx): void {
  for (const u of ctx.players as any[]) {
    if (String(u.spec) !== "255") continue;
    ctx.bump("survivalSet4");
    const pieces = setPiecesWorn(u, "2059");
    if (pieces >= 4)
      ctx.violate(
        "survivalSet4",
        OCC_SET4,
        ctx.start,
        u.name,
        `${u.name}: ${pieces} pieces`,
      );
  }
}

// ── GH #179 item 25 ────────────────────────────────────────────────────────
function timewalkerCap(ctx: IRoundCtx): void {
  const combat = combatOf(ctx);
  const augs = (ctx.players as any[]).filter((p) => String(p.spec) === "1473");
  if (augs.length === 0) return;
  for (const u of ctx.units as any[]) {
    if (!u.auraEvents?.length) continue;
    for (const iv of buildAuraIntervals(u, combat as any)) {
      if (!TIMEWALKER_LENGTHENED_IDS.has(iv.spellId)) continue;
      const aug = augs.find((p) => p.id === iv.srcUnitId);
      if (!aug) continue;
      ctx.bump("timewalkerCap");
      const official = buffFullDurationForCaster(iv.spellId, aug);
      const id = `${aug.name}:${u.name}:${iv.spellId}:${iv.fromS.toFixed(3)}`;
      const where = `${nameOf(iv.spellId, iv.spellName)} ${iv.spellId} on ${u.name} ${iv.fromS.toFixed(1)}–${iv.toS.toFixed(1)}s (official ${official ?? "?"}s)`;
      const closed = ((u.auraEvents ?? []) as any[]).some(
        (a) =>
          a.spellId === iv.spellId &&
          ev(a) === REMOVED &&
          Math.abs((tsOf(a) - ctx.start) / 1000 - iv.toS) < 0.01,
      );
      if (official !== undefined && iv.toS - iv.fromS > official + 0.5)
        ctx.violate(
          "timewalkerCap",
          OCC_TW_LONG,
          ctx.start + iv.fromS * 1000,
          id,
          where,
        );
      if (iv.inferredEnd && !closed)
        ctx.violate(
          "timewalkerCap",
          "left without REMOVED: the official-length cap decides its end",
          ctx.start + iv.fromS * 1000,
          id,
          where,
        );
    }
  }
}
