/**
 * consequenceFacts.ts — GH #70 experiment: deterministic "observable
 * consequence" lines for one round, rendered as an extra context section.
 *
 * User rulings (2026-09-19, 2026-09-24): coaching may describe what actually
 * happened after an event, kept separate from causal attribution. Allowed:
 * direct same-unit chains visible in the log (kicked → that cast lost and the
 * victim's next successful cast; a healer CC'd for N s → what their team's HP
 * did inside it) plus "forced" an enemy defensive / trinket / external, but
 * only behind an evidence gate (inside one of our kill attempts on that
 * target, target at or below FORCED_HP_GATE_PCT when it was used). The gate
 * value is an EXPERIMENT parameter, not a product constant — the report shows
 * its distribution; the user sets it. Counterfactuals stay banned.
 *
 * Every HP number goes through the `[STATE]` grid sampler (`gridHpPct` /
 * `gridHpMinInWindow`, render-grid seconds) so a line can never disagree with
 * the `[STATE]` tick printed for the same second (Shared-Predicate Rule).
 * Kill-attempt spans and their popped walls / externals come from
 * `extractKillAttempts` — the same objects the `[KILL ATTEMPTS]` block renders.
 *
 * Not product code: lives in eval until the user reads the examples.
 */
import { extractKillAttempts } from "@gladlog/analysis/src/utils/killAttempts";
import { analyzePlayerCCAndTrinket } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  gridHpMinInWindow,
  gridHpPct,
  isHealerSpec,
} from "@gladlog/analysis/src/utils/cooldowns";
import {
  getEnglishSpellName,
  kickLockoutSeconds,
} from "@gladlog/analysis/src/data/spellEffectData";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import { LogEvent } from "@gladlog/parser-compat";

/** Experiment default; the report sweeps 30/40/50/60/70. */
export const FORCED_HP_GATE_PCT_DEFAULT = 50;
/** A CC shorter than this is a GCD-sized blip — nothing to report inside it. */
const HEALER_CC_MIN_S = 2;

export interface ConsequenceLine {
  atS: number;
  kind: "kick" | "healer-cc" | "forced" | "used";
  text: string;
  /** forced/used only: target HP at use (grid) */
  hpAtUse?: number | null;
}

export interface ForcedSample {
  hpAtUse: number | null;
  inAttempt: boolean;
  /** trinket only: it broke a CC from our side (ccInstances trinketState "used") */
  brokeCc?: boolean;
  what: "defensive" | "external" | "trinket";
}

/** name → "N(Tag)" from the rendered context's roster (`<unit id="N" name="…">`
 * plus the first "N(Tag)" occurrence), so labels match every other line. */
export function labelMapFromContext(ctx: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of ctx.matchAll(/<unit id="(\d+)" name="([^"]+)"/g)) {
    const id = m[1]!;
    const tag = new RegExp(`(?:^|[^\\d])${id}\\(([A-Za-z]+)\\)`).exec(ctx);
    const label = tag ? `${id}(${tag[1]})` : id;
    out.set(m[2]!, label);
    out.set(m[2]!.split("-")[0]!, label);
  }
  return out;
}

export function buildConsequenceLines(
  combat: any,
  friends: any[],
  enemies: any[],
  ctx: string,
  gatePct: number = FORCED_HP_GATE_PCT_DEFAULT,
): { lines: ConsequenceLine[]; forcedSamples: ForcedSample[] } {
  const start: number = combat.startTime;
  const labels = labelMapFromContext(ctx);
  const L = (u: any): string =>
    labels.get(u.name) ?? labels.get(String(u.name).split("-")[0]) ?? u.name;
  const players = [...friends, ...enemies];
  const byId = new Map(players.map((u) => [u.id, u]));
  const sec = (ms: number): number => (ms - start) / 1000;
  const lines: ConsequenceLine[] = [];
  const teamOf = (u: any): any[] =>
    friends.some((f) => f.id === u.id) ? friends : enemies;
  const deathS = (u: any): number | null => {
    const d = (u.deathRecords ?? [])[0];
    return d ? sec(d.timestamp) : null;
  };

  // 1) Kicks → the cast is gone; when did the victim next complete a cast.
  const seen = new Set<string>();
  for (const kicker of players) {
    for (const a of (kicker.actionOut ?? []) as any[]) {
      if (a.logLine?.event !== LogEvent.SPELL_INTERRUPT) continue;
      const victim = byId.get(a.destUnitId);
      if (!victim || victim.reaction === kicker.reaction) continue;
      const key = `${a.timestamp}|${a.srcUnitId}|${a.destUnitId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = sec(a.timestamp);
      if (t < 0) continue;
      const lockS = kickLockoutSeconds(String(a.spellId ?? ""));
      const next = ((victim.spellCastEvents ?? []) as any[]).find(
        (c) =>
          c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS &&
          c.timestamp > a.timestamp,
      );
      const stopped =
        a.extraSpellId !== undefined
          ? getEnglishSpellName(a.extraSpellId, a.extraSpellName)
          : "a cast";
      const kick = getEnglishSpellName(
        a.spellId ?? "",
        a.spellName ?? "interrupt",
      );
      const nextPart = next
        ? `next completed cast by ${L(victim)} at ${fmtTime(sec(next.timestamp))} (${getEnglishSpellName(next.spellId ?? "", next.spellName ?? "")})`
        : `no completed cast by ${L(victim)} afterwards`;
      let teamPart = "";
      if (isHealerSpec(victim.spec)) {
        const from = Math.floor(t);
        const to = Math.floor(t + lockS);
        const drops: string[] = [];
        for (const mate of teamOf(victim)) {
          if (mate.id === victim.id) continue;
          const h0 = gridHpPct(mate, start + from * 1000);
          const lo = gridHpMinInWindow(mate, start, from, to);
          if (h0 === null || !lo) continue;
          if (h0 - lo.pct >= 10)
            drops.push(
              `${L(mate)} ${Math.round(h0)}% → ${Math.round(lo.pct)}% by ${fmtTime(lo.atSec)}`,
            );
        }
        const died = teamOf(victim).filter((m) => {
          const d = deathS(m);
          return d !== null && d >= t && d <= t + lockS;
        });
        if (drops.length)
          teamPart += `; inside the ${lockS}s lockout: ${drops.join(", ")}`;
        if (died.length)
          teamPart += `; died inside it: ${died.map(L).join(", ")}`;
      }
      lines.push({
        atS: t,
        kind: "kick",
        text: `${fmtTime(t)}  [CONSEQ]   ${L(kicker)} kicked ${L(victim)}'s ${stopped} (${kick}, ${lockS}s school lockout) → that cast never landed; ${nextPart}${teamPart}`,
      });
    }
  }

  // 2) A healer CC'd ≥ 2 s → what their team's HP did inside it.
  const enemyPets = Object.values(combat.units ?? {}).filter(
    (u: any) => u.ownerId && enemies.some((e) => e.id === u.ownerId),
  );
  const friendlyPets = Object.values(combat.units ?? {}).filter(
    (u: any) => u.ownerId && friends.some((f) => f.id === u.ownerId),
  );
  for (const healer of players.filter((u) => isHealerSpec(u.spec))) {
    const isFriend = friends.some((f) => f.id === healer.id);
    const opp = isFriend ? enemies : friends;
    const summary = analyzePlayerCCAndTrinket(
      healer,
      opp,
      combat,
      (isFriend ? enemyPets : friendlyPets) as any[],
    );
    for (const cc of summary.ccInstances) {
      if (cc.durationSeconds < HEALER_CC_MIN_S) continue;
      const from = Math.floor(cc.atSeconds);
      const to = Math.floor(cc.atSeconds + cc.durationSeconds);
      const parts: string[] = [];
      let quiet = 0;
      for (const mate of teamOf(healer)) {
        if (mate.id === healer.id) continue;
        const h0 = gridHpPct(mate, start + from * 1000);
        const lo = gridHpMinInWindow(mate, start, from, to);
        if (h0 === null || !lo) continue;
        // Only a real drop is a consequence; "100% → low 100%" is noise.
        if (h0 - lo.pct >= 10)
          parts.push(
            `${L(mate)} ${Math.round(h0)}% → low ${Math.round(lo.pct)}% at ${fmtTime(lo.atSec)}`,
          );
        else quiet++;
      }
      const died = teamOf(healer).filter((m) => {
        const d = deathS(m);
        return (
          d !== null &&
          d >= cc.atSeconds &&
          d <= cc.atSeconds + cc.durationSeconds
        );
      });
      if (!parts.length && !died.length && !quiet) continue;
      const src = byId.get(cc.sourceId);
      const body = parts.length
        ? parts.join(", ")
        : "no teammate dropped 10% or more";
      lines.push({
        atS: cc.atSeconds,
        kind: "healer-cc",
        text: `${fmtTime(cc.atSeconds)}  [CONSEQ]   ${isFriend ? "friendly healer" : "enemy healer"} ${L(healer)} in ${cc.spellName}${src ? ` (by ${L(src)})` : ""} for ${cc.durationSeconds.toFixed(0)}s → during it: ${body}${died.length ? `; died inside it: ${died.map(L).join(", ")}` : ""}`,
      });
    }
  }

  // 3) Enemy walls / externals / trinket inside OUR kill attempts on that
  //    target → "forced" only when the gate holds.
  const forcedSamples: ForcedSample[] = [];
  const attempts = extractKillAttempts(friends, enemies, combat);
  const enemyByName = new Map(enemies.map((e) => [e.name, e]));
  /** ", from N(Tag)" — the enemy teammate whose cast on `target` landed at `atS`. */
  const externalCaster = (target: any, atS: number): string => {
    for (const mate of enemies) {
      if (mate.id === target.id) continue;
      for (const c of (mate.spellCastEvents ?? []) as any[])
        if (
          c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS &&
          c.destUnitId === target.id &&
          Math.abs(sec(c.logLine.timestamp) - atS) < 0.01
        )
          return `, from ${L(mate)}`;
    }
    return "";
  };
  for (const at of attempts) {
    const target = enemyByName.get(at.targetName);
    if (!target) continue;
    const span = `${fmtTime(at.fromSeconds)}–${fmtTime(at.toSeconds)}`;
    const uses: { what: ForcedSample["what"]; name: string; atS: number }[] =
      [];
    const attr = at.attribution;
    if (attr) {
      attr.defensivePopped.forEach((n, i) =>
        uses.push({
          what: "defensive",
          name: n,
          atS: attr.defensivePoppedAtS[i]!,
        }),
      );
      attr.externalReceived.forEach((n, i) =>
        uses.push({
          what: "external",
          name: n,
          atS: attr.externalReceivedAtS[i]!,
        }),
      );
    }
    const tSummary = analyzePlayerCCAndTrinket(
      target,
      friends,
      combat,
      friendlyPets as any[],
    );
    for (const tu of tSummary.trinketUseTimes)
      if (tu >= at.fromSeconds && tu <= at.toSeconds)
        uses.push({ what: "trinket", name: "PvP trinket", atS: tu });
    for (const u of uses) {
      const hp = gridHpPct(target, start + Math.floor(u.atS) * 1000);
      forcedSamples.push({
        hpAtUse: hp,
        inAttempt: true,
        what: u.what,
        brokeCc:
          u.what === "trinket"
            ? tSummary.ccInstances.some(
                (cc) =>
                  cc.trinketState === "used" &&
                  u.atS >= cc.atSeconds - 0.5 &&
                  u.atS <= cc.atSeconds + cc.durationSeconds + 1,
              )
            : undefined,
      });
      const hpTxt = hp === null ? "HP unknown" : `${Math.round(hp)}% HP`;
      const forced = hp !== null && hp <= gatePct;
      const opener =
        at.anchor === "stun"
          ? `${at.anchorSpellName} opener`
          : `${at.anchorSpellName} burst`;
      lines.push({
        atS: u.atS,
        kind: forced ? "forced" : "used",
        hpAtUse: hp,
        text: `${fmtTime(u.atS)}  [CONSEQ]   ${
          u.what === "external"
            ? `${L(target)} received ${u.name} (external${externalCaster(target, u.atS)})`
            : `${L(target)} used ${u.name}`
        } at ${hpTxt} inside your kill attempt ${span} (${opener}) → ${forced ? `FORCED (gate: inside the attempt, at or below ${gatePct}% HP)` : `used, NOT counted as forced (gate: at or below ${gatePct}% HP${hp === null ? "; HP unknown" : ""})`}`,
      });
    }
  }
  // Baseline for the gate: the same enemies' trinket uses OUTSIDE attempts.
  for (const e of enemies) {
    const s = analyzePlayerCCAndTrinket(
      e,
      friends,
      combat,
      friendlyPets as any[],
    );
    for (const tu of s.trinketUseTimes) {
      const inAny = attempts.some(
        (a) =>
          a.targetName === e.name && tu >= a.fromSeconds && tu <= a.toSeconds,
      );
      if (inAny) continue;
      forcedSamples.push({
        hpAtUse: gridHpPct(e, start + Math.floor(tu) * 1000),
        inAttempt: false,
        what: "trinket",
      });
    }
  }

  lines.sort((a, b) => a.atS - b.atS);
  return { lines, forcedSamples };
}

export const CONSEQ_SECTION_HEADER =
  "OBSERVED CONSEQUENCES — what the log shows happened right after a kick, while a healer was CC'd, and which enemy defensives/trinkets came out inside your team's kill attempts. Measurements, not verdicts. `FORCED` is stamped only when the evidence gate holds; a line saying `NOT counted as forced` must not be described as forced.";

export function renderConsequenceSection(lines: ConsequenceLine[]): string {
  if (lines.length === 0) return "";
  return [CONSEQ_SECTION_HEADER, ...lines.map((l) => l.text)].join("\n");
}

/** Arm B's replacement for the findings prompt's causation hard rule. */
export const CAUSATION_RULE_A =
  '- Do NOT assert causation. No "because … you lost", "cost you the game", "that\'s why", "led to the loss". State observations and suggestions only.';
export const CAUSATION_RULE_B = [
  "- Observable consequences are allowed; causal verdicts are not. You MAY state what the log shows happened right after an event, when an OBSERVED CONSEQUENCES line states it and the finding cites an event at that moment: a kick meant that cast never landed and the victim's next completed cast came later; while a healer was CC'd a teammate dropped as stated; an enemy defensive/trinket/external stamped FORCED was forced by that attempt (never call a `NOT counted as forced` line forced). Use words, not digits, as everywhere in \"explanation\".",
  '- Still NEVER: counterfactuals ("would have", "could have saved", "if you had … they would"), and never pin a death, loss or win on one event ("led to the death", "cost you the round", "that\'s why you lost", "decided the game").',
].join("\n");
