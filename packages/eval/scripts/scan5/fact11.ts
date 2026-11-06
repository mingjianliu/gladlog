/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * fact11 (F26) class checks.
 *
 *  - channelEndOnOwnRow (D2): a `[YOU] [CD] <channel> (channeled Ns, ended
 *    M:SS)` line whose channel the log ends later — the owner's same-id aura
 *    from that press is REMOVED more than a second after the printed end —
 *    with nothing of another name pressed or begun by the owner in between
 *    (a row of the channel's own name is its tick or a copy: Divine Hymn's
 *    64844). Counted: every such line whose press has its own aura.
 *  - channelSpanUnrun (D39): a BURST LEDGER cooldown span `<channel> a:bb–c:dd`
 *    of a channel (`CHANNELED_SPELL_IDS`) the game refused at its press — a
 *    SPELL_MISSED of the press's id by the owner within 50 ms of the press,
 *    no aura of the id on the owner from it, nothing of its name after the
 *    refusal before the next press of it — printed with a length (c:dd past
 *    a:bb). Counted: every ledger span of a channel.
 *  - doomWindsNoPressReading (D7 / D44): a Doom Winds buff 466772 a player
 *    put on itself with neither a Doom Winds press 384352 nor an Ascendance
 *    114051 (cast or aura) of that player within 1 s. On a log from 12.1.5
 *    on it is a proc: a line of that second naming it as a press — an
 *    `[ENEMY CD]` Doom Winds line without `(no press)` — is a violation; on
 *    an older log it is an unlogged press: a `[YOU] / [TEAM] [PROC] Doom
 *    Winds (no press)` line of that second is. Kinds `proc as press`,
 *    `press as proc`. Counted: every such buff in the round.
 *  - intoImmunityLanded (D20 / D21): an ABILITIES INTO IMMUNITY/DR line into
 *    a wall that stops every hit it covers (pct 100: an immunity or a
 *    deflection) listing a spell more times than the player has casts of it
 *    on that enemy the log does NOT show getting through: a cast whose own
 *    first row on the target inside the wall is a damage row or a miss of
 *    type ABSORB (a shield ate it) landed — Blackout Kick into Cloak of
 *    Shadows, a Chaos Bolt hitting for 220k inside Aspect of the Turtle.
 *    Counted: every (line, spell) into such a wall.
 *  - pressImmuneTagLanded (D10): a `[YOU]` / `[TEAM]` press line tagged
 *    `[IMMUNE …]` for a press that is no control (`ccSpellIds`) whose every
 *    IMMUNE row (the press's ids, `castAndEffectIds`, within 3 s) is on a
 *    unit a damage or heal row of the same press reached in the IMMUNE
 *    row's own instant (`PRESS_LANDED_SAME_INSTANT_MS`) —
 *    one component refused (The Hunt's root into Blessing of Freedom), not
 *    the press. Counted: every IMMUNE-tagged line of a non-control press.
 *  - immuneCauseCannotStopDamage (D32): a `[… — X was up]` IMMUNE cause on a
 *    press line whose IMMUNE row is a spell with no control and no DB2
 *    mechanic (a damage spell), naming an aura X that is no pct-100 wall
 *    stopping that spell's school — a control avoidance (Precognition)
 *    named for a Lava Burst into Ice Block. The cause stands when it stops
 *    one of the press's such rows on that row's unit. Counted: every press
 *    line naming an IMMUNE cause with such a row.
 *  - exposureThreatOnFormHealer (D27): a `[HEALER EXPOSURE]` line listing
 *    any control threat while a healer of the owner's team is in a Spirit of
 *    Redemption form (`auraIsImmunityForm`: immune to control, user ruling
 *    fact2 5 / F20) at the line's second — the log's own aura rows. Counted:
 *    every `[HEALER EXPOSURE]` line.
 *  - variantSpentButton (D22 D25 D29): on a log from before a dated
 *    override variant's cutover (`OVERRIDE_VARIANT_SHARES_BY_ERA`: Predator's
 *    Wake 1259431 → The Hunt 1246167 before 12.1.5), a `[RES]` `cd:` entry of
 *    the button (`The Hunt(Ns)`) for a unit that pressed no button-id
 *    (`SPELL_CAST_SUCCESS` of the button or a still-shared alias of it, never
 *    the variant) within the button's cooldown before that second — the
 *    variant's press spent it. Counted: every `[RES]` cd entry of such a
 *    button on such a log.
 */
import { castAndEffectIds } from "@gladlog/analysis/src/data/castEffectAuras";
import { CHANNELED_SPELL_IDS } from "@gladlog/analysis/src/data/channeledGenerated";
import { OVERRIDE_VARIANTS_GENERATED } from "@gladlog/analysis/src/data/overrideVariantsGenerated";
import { effectiveCooldownSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import {
  isControlCast,
  PRESS_LANDED_SAME_INSTANT_MS,
  PRESS_TRIGGERED_CAST_IDS,
} from "@gladlog/analysis/src/utils/castMissRows";
import { COPY_CAST_IDS } from "@gladlog/analysis/src/utils/castPress";
import { auraIsImmunityForm } from "@gladlog/analysis/src/utils/combatStates";
import {
  immunityStopsSpellSchool,
  wallStopsEveryHit,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { OVERRIDE_VARIANT_SHARES_BY_ERA } from "@gladlog/analysis/src/utils/overrideVariantEra";
import { ccMechanicOf } from "@gladlog/analysis/src/utils/spellMechanics";
import { PATCH_1215_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/talents";

import {
  ABSORBED,
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REMOVED,
  secOf,
  SUCCESS,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "channelEndOnOwnRow",
  "channelSpanUnrun",
  "doomWindsNoPressReading",
  "intoImmunityLanded",
  "pressImmuneTagLanded",
  "immuneCauseCannotStopDamage",
  "exposureThreatOnFormHealer",
  "variantSpentButton",
] as const;

export function run(ctx: IRoundCtx): void {
  doomWindsNoPressReading(ctx);
  intoImmunityLanded(ctx);
  pressImmuneTagChecks(ctx);
  exposureThreatOnFormHealer(ctx);
  variantSpentButton(ctx);
  if (!ctx.owner) return;
  channelEndOnOwnRow(ctx);
  channelSpanUnrun(ctx);
}

const CHANNELED_LINE =
  /^(\d+:\d{2})\s+\[YOU\] \[CD\]\s+(.+?)(?: \[[^\]]*\])? \(channeled ([\d.]+)s, ended (\d+:\d{2})\)/;

const castsOf = (u: any): any[] =>
  ((u.spellCastEvents ?? []) as any[]).filter((c) => ev(c) === SUCCESS);

function channelEndOnOwnRow(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  for (const l of ctx.lines) {
    const m = CHANNELED_LINE.exec(l);
    if (!m) continue;
    const name = m[2]!;
    const castS = secOf(m[1]!);
    // the press is the same-second row of that name whose own id put an
    // aura on the owner (Divine Hymn's 64843; its 64844 tick rows put none)
    const ownAura = (id: string) =>
      ((owner.auraEvents ?? []) as any[]).filter(
        (a) =>
          String(a.spellId) === id &&
          a.srcUnitId === owner.id &&
          a.destUnitId === owner.id,
      );
    let press: any;
    let applied: any;
    for (const c of castsOf(owner)) {
      if (nameOf(c.spellId, c.spellName) !== name) continue;
      // a copy row is no press: Divine Hymn's 64844 heal-buff rows put a 15 s
      // buff of their own id on the priest, not the channel
      if (COPY_CAST_IDS.has(String(c.spellId))) continue;
      if (Math.floor((tsOf(c) - ctx.start) / 1000) !== castS) continue;
      applied = ownAura(String(c.spellId)).find(
        (a) => ev(a) === APPLIED && Math.abs(tsOf(a) - tsOf(c)) <= 100,
      );
      if (applied) {
        press = c;
        break;
      }
    }
    if (!press) continue;
    const id = String(press.spellId);
    const pressMs = tsOf(press);
    const removed = ownAura(id).find(
      (a) => ev(a) === REMOVED && tsOf(a) > tsOf(applied),
    );
    if (!removed) continue;
    ctx.bump("channelEndOnOwnRow");
    const printedEndS = secOf(m[4]!);
    const trueEndS = (tsOf(removed) - ctx.start) / 1000;
    if (!(trueEndS > printedEndS + 1)) continue;
    const otherInside = [
      ...castsOf(owner),
      ...((owner.castStartEvents ?? []) as any[]),
    ].some(
      (c) =>
        tsOf(c) > pressMs &&
        tsOf(c) <= ctx.start + (printedEndS + 1) * 1000 &&
        nameOf(c.spellId, c.spellName) !== name,
    );
    if (otherInside) continue;
    ctx.violate(
      "channelEndOnOwnRow",
      name,
      pressMs,
      `${owner.name}:${id}:${pressMs}`,
      `${name} pressed ${((pressMs - ctx.start) / 1000).toFixed(3)}s, aura removed ${trueEndS.toFixed(3)}s, printed channeled ${m[3]}s ended ${m[4]}; nothing else pressed before`,
      l,
    );
  }
}

const LEDGER_BURST = /^\s+Burst #\d+ — [^|]*\|\s*(.*)$/;
const LEDGER_SPAN = /(.+?) (\d+:\d{2})–(\d+:\d{2})$/;

function channelSpanUnrun(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  const channelNames = new Set<string>();
  for (const c of castsOf(owner))
    if (CHANNELED_SPELL_IDS.has(String(c.spellId)))
      channelNames.add(nameOf(c.spellId, c.spellName));
  if (channelNames.size === 0) return;
  for (const l of ctx.text.split("\n")) {
    const b = LEDGER_BURST.exec(l);
    if (!b) continue;
    for (const part of b[1]!.split(" + ")) {
      const s = LEDGER_SPAN.exec(part.trim());
      if (!s || !channelNames.has(s[1]!)) continue;
      ctx.bump("channelSpanUnrun");
      const fromS = secOf(s[2]!);
      const toS = secOf(s[3]!);
      if (!(toS > fromS)) continue;
      const presses = castsOf(owner).filter(
        (c) => nameOf(c.spellId, c.spellName) === s[1],
      );
      const press = presses.find(
        (c) => Math.floor((tsOf(c) - ctx.start) / 1000) === fromS,
      );
      if (!press) continue;
      const id = String(press.spellId);
      const pressMs = tsOf(press);
      const nextMs = tsOf(
        presses.find((c) => tsOf(c) > pressMs) ?? {
          timestamp: ctx.end,
        },
      );
      const refusal = ((owner.missesOut ?? []) as any[]).find(
        (r) =>
          r.srcUnitId === owner.id &&
          String(r.spellId) === id &&
          Math.abs(tsOf(r) - pressMs) <= 50,
      );
      if (!refusal) continue;
      const aura = ((owner.auraEvents ?? []) as any[]).some(
        (a) =>
          String(a.spellId) === id &&
          a.srcUnitId === owner.id &&
          ev(a) === APPLIED &&
          tsOf(a) >= pressMs - 100 &&
          tsOf(a) < nextMs,
      );
      if (aura) continue;
      const effect = [
        ...((owner.damageOut ?? []) as any[]),
        ...((owner.healOut ?? []) as any[]),
        ...((owner.missesOut ?? []) as any[]),
      ].some(
        (r) =>
          r.srcUnitId === owner.id &&
          tsOf(r) > tsOf(refusal) &&
          tsOf(r) < nextMs &&
          nameOf(r.spellId, r.spellName) === s[1],
      );
      if (effect) continue;
      ctx.violate(
        "channelSpanUnrun",
        s[1]!,
        pressMs,
        `${owner.name}:${id}:${pressMs}`,
        `${s[1]} pressed ${((pressMs - ctx.start) / 1000).toFixed(3)}s, refused ${((tsOf(refusal) - ctx.start) / 1000).toFixed(3)}s, no aura, no effect before the next press; printed ${s[2]}–${s[3]}`,
        l.trim(),
      );
    }
  }
}

function doomWindsNoPressReading(ctx: IRoundCtx): void {
  const since1215 = ctx.start >= PATCH_1215_GOLIVE_EPOCH_MS;
  for (const u of ctx.players) {
    const near = (ms: number, ids: string[]) =>
      [
        ...((u.spellCastEvents ?? []) as any[]).filter(
          (c) => ev(c) === SUCCESS,
        ),
        ...((u.auraEvents ?? []) as any[]).filter(
          (a) => ev(a) === APPLIED && a.srcUnitId === u.id,
        ),
      ].some(
        (e) => ids.includes(String(e.spellId)) && Math.abs(tsOf(e) - ms) <= 1000,
      );
    for (const a of (u.auraEvents ?? []) as any[]) {
      if (String(a.spellId) !== "466772" || ev(a) !== APPLIED) continue;
      if (a.srcUnitId !== u.id || a.destUnitId !== u.id) continue;
      const ms = tsOf(a);
      if (ms < ctx.start || ms > ctx.roundEndAt) continue;
      if (near(ms, ["384352", "114051"])) continue;
      ctx.bump("doomWindsNoPressReading");
      const s = Math.floor((ms - ctx.start) / 1000);
      const mmss = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      const pid = ctx.pidOf(u.name);
      const atSecond = ctx.lines.filter(
        (l) => l.startsWith(`${mmss} `) && /Doom Winds/.test(l),
      );
      const bad = since1215
        ? atSecond.find(
            (l) =>
              /\[ENEMY CD\]/.test(l) &&
              (pid === undefined || l.includes(`${pid}(`)) &&
              !l.includes("Doom Winds (no press)"),
          )
        : atSecond.find(
            (l) =>
              /\[(YOU|TEAM)\] \[PROC\]/.test(l) &&
              l.includes("Doom Winds (no press)") &&
              (/\[YOU\]/.test(l)
                ? u.id === ctx.owner?.id
                : pid === undefined || l.includes(`${pid}(`)),
          );
      if (!bad) continue;
      ctx.violate(
        "doomWindsNoPressReading",
        since1215 ? "proc as press" : "press as proc",
        ms,
        `${u.name}:${ms}`,
        `${u.name} Doom Winds buff ${((ms - ctx.start) / 1000).toFixed(3)}s, no press / Ascendance within 1 s, ${since1215 ? "12.1.5" : "12.1.0"} log`,
        bad,
      );
    }
  }
}

const PERIODIC_DAMAGE = "SPELL_PERIODIC_DAMAGE";
const PERIODIC_MISSED = "SPELL_PERIODIC_MISSED";
const MISSED = "SPELL_MISSED";

const INTO_LINE = /^\s+\[(\d+:\d{2})\] [^(]+\((.+?)\): (.+) into (.+)'s (.+?)(?: \(deferral\))?$/;

function intoImmunityLanded(ctx: IRoundCtx): void {
  const at = ctx.text.indexOf("ABILITIES INTO IMMUNITY/DR");
  if (at < 0) return;
  for (const l of ctx.text.slice(at).split("\n").slice(1)) {
    if (l.trim() === "") break;
    const m = INTO_LINE.exec(l);
    if (!m) continue;
    const player = ctx.byName.get(m[2]!);
    const target = ctx.byName.get(m[4]!);
    if (!player || !target) continue;
    const sec = secOf(m[1]!);
    const auras = ((target.auraEvents ?? []) as any[])
      .filter((a) => a.destUnitId === target.id)
      .sort((a, b) => tsOf(a) - tsOf(b));
    const app = auras.find(
      (a) =>
        ev(a) === APPLIED &&
        nameOf(a.spellId, a.spellName) === m[5] &&
        Math.floor((tsOf(a) - ctx.start) / 1000) === sec,
    );
    if (!app || !wallStopsEveryHit(String(app.spellId))) continue;
    const rem = auras.find(
      (a) =>
        ev(a) === REMOVED && a.spellId === app.spellId && tsOf(a) >= tsOf(app),
    );
    const from = tsOf(app);
    const to = rem ? tsOf(rem) : ctx.end;
    const listed = new Map<string, number>();
    for (const n of m[3]!.split(" + "))
      listed.set(n, (listed.get(n) ?? 0) + 1);
    for (const [name, k] of listed) {
      ctx.bump("intoImmunityLanded");
      // the target's direct rows of this spell by the player, in order
      const rows = [
        ...((player.damageOut ?? []) as any[]).filter(
          (d) => ev(d) !== ABSORBED && ev(d) !== PERIODIC_DAMAGE,
        ),
        ...((player.missesOut ?? []) as any[]).filter(
          (x) => ev(x) !== PERIODIC_MISSED,
        ),
      ]
        .filter(
          (r) =>
            r.destUnitId === target.id && nameOf(r.spellId, r.spellName) === name,
        )
        .sort((a, b) => tsOf(a) - tsOf(b));
      const casts = castsOf(player)
        .filter(
          (c) =>
            c.destUnitId === target.id &&
            nameOf(c.spellId, c.spellName) === name &&
            tsOf(c) >= from - 6000 &&
            tsOf(c) <= to,
        )
        .sort((a, b) => tsOf(a) - tsOf(b));
      let next = 0;
      let notThrough = 0;
      let through = 0;
      for (const c of casts) {
        while (next < rows.length && tsOf(rows[next]) < tsOf(c) - 100) next++;
        const row = rows[next];
        const landsAt = row && tsOf(row) <= tsOf(c) + 3000 ? row : undefined;
        if (landsAt) next++;
        const t = landsAt ? tsOf(landsAt) : tsOf(c);
        if (t < from || t > to) continue;
        const hit =
          !!landsAt &&
          (ev(landsAt) !== MISSED || landsAt.missType === "ABSORB");
        if (hit) through++;
        else notThrough++;
      }
      if (k <= notThrough || through === 0) continue;
      ctx.violate(
        "intoImmunityLanded",
        "landed listed",
        from,
        `${player.name}#${target.name}#${sec}#${name}`,
        `${name} listed ×${k} into ${m[5]} (${(from - ctx.start) / 1000}–${(to - ctx.start) / 1000}s); ${through} of its casts landed through it, ${notThrough} did not`,
        l.trim(),
      );
    }
  }
}

const PRESS_LINE = /^(\d+:\d{2})\s+\[(YOU|TEAM)\] \[[A-Z ]+\]\s+(.*?) \[IMMUNE(?:: [^\]—]+)?(?: — (.+?) was up)?\]/;

function pressImmuneTagChecks(ctx: IRoundCtx): void {
  const friends = ctx.owner
    ? ctx.players.filter((p) => p.reaction === ctx.owner.reaction)
    : [];
  for (const l of ctx.lines) {
    const m = PRESS_LINE.exec(l);
    if (!m) continue;
    const sec = secOf(m[1]!);
    const head = m[3]!;
    const actor =
      m[2] === "YOU"
        ? ctx.owner
        : friends.find((f) => {
            const pid = ctx.pidOf(f.name);
            return pid !== undefined && head.includes(`${pid}(`);
          });
    if (!actor) continue;
    const press = castsOf(actor).find(
      (c) =>
        Math.floor((tsOf(c) - ctx.start) / 1000) === sec &&
        head.includes(nameOf(c.spellId, c.spellName)),
    );
    if (!press) continue;
    const id = String(press.spellId);
    const name = nameOf(press.spellId, press.spellName);
    // the press and the cast rows its effect triggers
    // (`PRESS_TRIGGERED_CAST_IDS`: Predator's Wake lands as The Hunt 1246169)
    const ids = [id, ...(PRESS_TRIGGERED_CAST_IDS.get(id) ?? [])];
    const family = new Set(ids.flatMap((i) => [...castAndEffectIds(i)]));
    const names = new Set(ids.map((i) => nameOf(i, i === id ? name : "")));
    const ofPress = (r: any) =>
      family.has(String(r.spellId)) || names.has(nameOf(r.spellId, r.spellName));
    const inWindow = (r: any) =>
      tsOf(r) >= tsOf(press) - 100 && tsOf(r) <= tsOf(press) + 3000;
    const immune = ((actor.missesOut ?? []) as any[]).filter(
      (x) =>
        x.missType === "IMMUNE" &&
        ev(x) !== PERIODIC_MISSED &&
        inWindow(x) &&
        ofPress(x),
    );
    if (immune.length === 0) continue;
    if (!ccSpellIds.has(id)) {
      ctx.bump("pressImmuneTagLanded");
      const hits = [
        ...((actor.damageOut ?? []) as any[]).filter(
          (d) =>
            ev(d) !== ABSORBED || family.has(String(d.attackSpellId ?? "")),
        ),
        ...((actor.healOut ?? []) as any[]),
      ].filter(
        (r) =>
          inWindow(r) &&
          (ofPress(r) ||
            (ev(r) === ABSORBED && family.has(String(r.attackSpellId ?? "")))),
      );
      // landed through the refused component: a hit on that unit in the
      // refusal's own instant (`PRESS_LANDED_SAME_INSTANT_MS`)
      const landedAt = (x: any) =>
        hits.some(
          (r) =>
            r.destUnitId === x.destUnitId &&
            Math.abs(tsOf(r) - tsOf(x)) <= PRESS_LANDED_SAME_INSTANT_MS,
        );
      if (immune.every(landedAt))
        ctx.violate(
          "pressImmuneTagLanded",
          name,
          tsOf(press),
          `${actor.name}:${id}:${tsOf(press)}`,
          `${name} IMMUNE only on ${[...new Set(immune.map((x) => nameOf(x.spellId, x.spellName) + " " + x.spellId))].join(", ")}; the press landed on the same unit(s)`,
          l,
        );
    }
    const cause = m[4];
    if (!cause) continue;
    // the press's damage-spell IMMUNE rows; the cause is right when the
    // named aura stops one of them on its own unit (Divine Toll 375576
    // IMMUNE on the mage in Ice Block and on a second unit in the same ms)
    const rows = immune.filter((x) => {
      const xid = String(x.spellId);
      return (
        !isControlCast(xid) &&
        ccMechanicOf(xid) === undefined &&
        ctx.units.some((u) => u.id === x.destUnitId)
      );
    });
    if (rows.length === 0) continue;
    ctx.bump("immuneCauseCannotStopDamage");
    const stops = (x: any): boolean => {
      const xid = String(x.spellId);
      const target = ctx.units.find((u) => u.id === x.destUnitId)!;
      return ((target.auraEvents ?? []) as any[]).some(
        (a) =>
          a.destUnitId === target.id &&
          nameOf(a.spellId, a.spellName) === cause &&
          tsOf(a) <= tsOf(x) &&
          wallStopsEveryHit(String(a.spellId)) &&
          immunityStopsSpellSchool(String(a.spellId), xid) !== false,
      );
    };
    if (!rows.some(stops)) {
      const x = rows[0]!;
      const xid = String(x.spellId);
      ctx.violate(
        "immuneCauseCannotStopDamage",
        cause,
        tsOf(x),
        `${actor.name}:${xid}:${tsOf(x)}`,
        `${nameOf(x.spellId, x.spellName)} ${xid} IMMUNE (no control, no mechanic) named "${cause} was up" — no pct-100 wall stopping its school`,
        l,
      );
    }
  }
}

function exposureThreatOnFormHealer(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const friends = ctx.players.filter((p) => p.reaction === ctx.owner.reaction);
  for (const l of ctx.lines) {
    if (!/^\d+:\d{2}\s+\[HEALER EXPOSURE\]/.test(l)) continue;
    ctx.bump("exposureThreatOnFormHealer");
    if (!/ Full DR| Half DR| Quarter DR/.test(l)) continue;
    const ms = ctx.start + secOf(l.slice(0, l.indexOf(" "))) * 1000;
    for (const f of friends) {
      const rows = ((f.auraEvents ?? []) as any[])
        .filter(
          (a) =>
            a.destUnitId === f.id && auraIsImmunityForm(String(a.spellId)),
        )
        .sort((a, b) => tsOf(a) - tsOf(b));
      const app = [...rows]
        .reverse()
        .find((a) => ev(a) === APPLIED && tsOf(a) <= ms);
      if (!app) continue;
      const rem = rows.find((a) => ev(a) === REMOVED && tsOf(a) > tsOf(app));
      if (rem && tsOf(rem) <= ms + 999) continue;
      ctx.violate(
        "exposureThreatOnFormHealer",
        nameOf(app.spellId, app.spellName),
        ms,
        `${f.name}:${ms}`,
        `${f.name} in ${nameOf(app.spellId, app.spellName)} from ${((tsOf(app) - ctx.start) / 1000).toFixed(3)}s${rem ? ` to ${((tsOf(rem) - ctx.start) / 1000).toFixed(3)}s` : ""}; exposure line lists control threats`,
        l,
      );
      break;
    }
  }
}

const RES_CD = /\[RES\] .*?\bcd:(\S.*?)(?: {2}|$)/;

function variantSpentButton(ctx: IRoundCtx): void {
  const dated = Object.entries(OVERRIDE_VARIANT_SHARES_BY_ERA).filter(
    ([, d]) => !d.before && ctx.start < d.cutoverEpochMs,
  );
  if (dated.length === 0) return;
  for (const [variant] of dated) {
    const button = OVERRIDE_VARIANTS_GENERATED[variant];
    if (!button) continue;
    const name = nameOf(button);
    const cdS = effectiveCooldownSeconds(button) ?? 0;
    let atS = 0;
    for (const l of ctx.text.split("\n")) {
      const t = /^(\d+:\d{2})\s/.exec(l);
      if (t) atS = secOf(t[1]!);
      const m = RES_CD.exec(l);
      if (!m) continue;
      for (const entry of m[1]!.split(",")) {
        const e = /^(?:(\d+):)?(.+?)\((\d+)s\)$/.exec(entry.trim());
        if (!e || e[2] !== name) continue;
        const unit = e[1] === undefined ? ctx.owner : ctx.unitOfPid(e[1]);
        // only a unit that pressed the variant this round (another spec's
        // button can share the name: Havoc's The Hunt 370965)
        if (unit && !castsOf(unit).some((c) => String(c.spellId) === variant))
          continue;
        ctx.bump("variantSpentButton");
        if (!unit) {
          ctx.violate(
            "variantSpentButton",
            "unresolved pid",
            ctx.start + atS * 1000,
            `pid${e[1]}:${atS}`,
            `pid ${e[1]} unresolved`,
            l.trim().slice(0, 160),
          );
          continue;
        }
        // the button's own last press up to this second: the most it can
        // have left is that press's cooldown run from it
        const last = castsOf(unit)
          .filter((c) => {
            const id = String(c.spellId);
            // the button's own id: the press's impact row carries the
            // button's name after either press (The Hunt 1246169)
            return id === button && (tsOf(c) - ctx.start) / 1000 < atS + 1;
          })
          .map((c) => (tsOf(c) - ctx.start) / 1000)
          .sort((a, b) => b - a)[0];
        const leftAtMost = last === undefined ? 0 : last + cdS - atS;
        if (Number(e[3]) <= leftAtMost + 2) continue;
        ctx.violate(
          "variantSpentButton",
          name,
          ctx.start + atS * 1000,
          `${unit.name}:${atS}:${name}`,
          `${unit.name}: ${name}(${e[3]}s) at ${atS}s; its own last press ${last === undefined ? "none" : last.toFixed(1) + "s"} leaves at most ${Math.max(0, leftAtMost).toFixed(0)}s (pre-cutover log: ${nameOf(variant)} ${variant} is its own cooldown)`,
          l.trim().slice(0, 220),
        );
      }
    }
  }
}
