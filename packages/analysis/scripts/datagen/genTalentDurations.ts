/**
 * Talent duration extensions read off the talent tooltips (GH #155,
 * 2026-10-21) — the reading half; `packages/eval/scripts/talentDurationVerify.ts`
 * is the verifying half (each entry against the corpus, holders vs
 * non-holders, ranks from COMBATANT_INFO).
 *
 * Why the tooltip: a talent that lengthens a buff is often a DB2 dummy aura
 * with no class mask or label, so `genTalentModifiers.ts` (SpellMod rows)
 * never sees it — and the tooltip says it in one line (user correction
 * 2026-10-21: 「你们完全没有去读天赋……我们只需要验证就行，不需要盲猜」).
 * Pattern: `genTalentMitigation.ts` (zhCN tooltip as the predicate, numbers
 * by the placeholders the tooltip itself names, the residue as
 * `unparsed` — never guessed). Parsing lives in lib/tooltipDurations.ts.
 *
 * Output `src/data/talentDurationTooltipsGenerated.json`:
 *  - `entries`: one per (talent, parsed sentence) with the specs that read it,
 *    the shape (fixed / per-event / set), the amount and unit, the cap, the
 *    trigger words verbatim, and each target name resolved to the spell ids
 *    of that name that carry a duration (the ones the corpus has seen
 *    flagged), with their DB2 base seconds.
 *  - `unparsed`: the sentences that say a duration is extended but could not
 *    be read (an unresolvable placeholder, a pronoun for a target).
 * Positive controls (throw when missing): Spiritwalker's Momentum 443425
 * (per-event, +1 s, cap 4 s, Spiritwalker's Grace), Rampaging Berserker's
 * Recklessness row 1269310 (fixed, percent), Improved Barkskin 327993.
 *
 * Usage: `DATAGEN_CACHE=~/.cache/gladlog-datagen npx tsx
 * packages/analysis/scripts/datagen/genTalentDurations.ts`
 */
import { homedir } from "node:os";
import { join } from "node:path";

import observedSpellIds from "../../src/data/observedSpellIdsGenerated.json";
import { PVP_TALENT_POOL_GENERATED } from "../../src/data/pvpTalentPoolGenerated";
import talentIdMap from "../../src/data/talentIdMap.json";
import { writeArtifact } from "./lib/emit";
import { pvpBasePoints } from "./lib/pvpMultiplier";
import { talentClassMapOf } from "./lib/talentInventory";
import {
  expandForSpec,
  type IDurationClause,
  parseDurationClauses,
} from "./lib/tooltipDurations";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

const DURATION_SENTENCE_RE =
  /持续时间(?:延长|增加|提高)|延长.{0,12}持续时间|持续时间.{0,6}(?:延长|增加)/;

export interface ITalentDurationEntry {
  talentSpellId: string;
  specs: string[];
  kind: IDurationClause["kind"];
  unit: IDurationClause["unit"];
  amount: number;
  cap?: number;
  capUnit?: IDurationClause["capUnit"];
  trigger?: string;
  sentence: string;
  /** some spec's rendering had a branch condition that could not be decided */
  undecidedBranch?: true;
  targets: Array<{
    name: string;
    /** how the name was tied to spells: the exact name, the name with its
     * modifiers (下一个 / 效果 / 身上的 …) stripped, the longest spell name
     * the text contains, or the sentence's subject (the target was implied
     * or a pronoun) — anything but `exact` is weaker and the verifier says so */
    matchedBy: "exact" | "cleaned" | "contained" | "subject";
    /** the spell ids of that name with a finite DB2 duration */
    spellIds: string[];
    /** of those, the ones the corpus has observed */
    observedIds: string[];
    /** DB2 duration in seconds, per id */
    baseSeconds: Record<string, number>;
  }>;
}

async function main(): Promise<void> {
  const build = await resolveBuild();
  const cache =
    process.env.DATAGEN_CACHE ?? join(homedir(), ".cache/gladlog-datagen");
  const [
    spellZh,
    nameZh,
    effectRaw,
    miscRaw,
    durRaw,
    specSpellsRaw,
    chrSpecRaw,
  ] = await Promise.all([
    fetchTable("Spell", build, cache, "zhCN"),
    fetchTable("SpellName", build, cache, "zhCN"),
    fetchTable("SpellEffect", build, cache),
    fetchTable("SpellMisc", build, cache),
    fetchTable("SpellDuration", build, cache),
    fetchTable("SpecializationSpells", build, cache),
    fetchTable("ChrSpecialization", build, cache),
  ]);

  const spell = parseCsv(spellZh);
  assertColumns(spell.header, ["ID", "Description_lang"], "Spell(zhCN)");
  const descriptionOf = new Map(
    spell.rows.map((r) => [r.ID ?? "", r.Description_lang ?? ""]),
  );

  const effects = parseCsv(effectRaw);
  assertColumns(
    effects.header,
    ["SpellID", "EffectIndex", "DifficultyID", "EffectBasePointsF"],
    "SpellEffect",
  );
  const pointsOf = new Map<string, number>();
  for (const r of effects.rows) {
    if (r.DifficultyID !== "0") continue;
    pointsOf.set(`${r.SpellID}:${r.EffectIndex}`, pvpBasePoints(r));
  }
  const durationMsOfIndex = new Map<string, number>();
  for (const r of parseCsv(durRaw).rows)
    durationMsOfIndex.set(r.ID!, Number(r.Duration));
  const durationS = new Map<string, number>();
  for (const r of parseCsv(miscRaw).rows) {
    if (r.DifficultyID !== "0") continue;
    const ms = durationMsOfIndex.get(r.DurationIndex ?? "") ?? 0;
    if (ms > 0) durationS.set(r.SpellID!, ms / 1000);
  }

  const idsOfName = new Map<string, string[]>();
  for (const r of parseCsv(nameZh).rows) {
    const n = (r.Name_lang ?? "").trim();
    if (!n) continue;
    const l = idsOfName.get(n) ?? [];
    l.push(r.ID!);
    idsOfName.set(n, l);
  }
  const nameOfId = new Map<string, string>();
  for (const [n, ids] of idsOfName) for (const id of ids) nameOfId.set(id, n);
  // the names that can be a target: some id of the name has a duration
  // generic words that also happen to be some spell's name: never a target
  // by themselves (392099 「当你对生命值全满的目标施放回春术时，它的持续时间…」
  // must find 回春术, not 生命)
  const GENERIC_NAMES = new Set([
    "生命",
    "目标",
    "召唤",
    "效果",
    "战斗中",
    "治疗",
    "伤害",
    "持续治疗",
    "疾病",
    "元素",
  ]);
  const durationNames = new Set(
    [...idsOfName]
      .filter(([n, ids]) => !GENERIC_NAMES.has(n) && ids.some((id) => durationS.has(id)))
      .map(([n]) => n),
  );
  const longestName = Math.max(...[...durationNames].map((n) => n.length));
  /** the earliest (then longest) duration-carrying spell name in `text` */
  const firstNameIn = (text: string): string | undefined => {
    const byId = /#(\d+)/.exec(text);
    for (let i = 0; i < text.length; i++) {
      if (byId && byId.index === i) return `#${byId[1]}`;
      for (let L = Math.min(longestName, text.length - i); L >= 2; L--) {
        const sub = text.slice(i, i + L);
        if (durationNames.has(sub)) return sub;
      }
    }
    return undefined;
  };
  const MODIFIER_RE =
    /^(?:.*身上的|下一个|你所有的|所有的|该)|(?:效果|技能|在战斗中助阵|的范围|的剩余)$/g;
  const resolveName = (
    raw: string,
  ): { name: string; ids: string[]; matchedBy: ITalentDurationEntry["targets"][number]["matchedBy"] } => {
    const byId = /^#(\d+)/.exec(raw);
    if (byId) return { name: nameOfId.get(byId[1]!) ?? raw, ids: [byId[1]!], matchedBy: "exact" };
    if (idsOfName.has(raw)) return { name: raw, ids: idsOfName.get(raw)!, matchedBy: "exact" };
    const cleaned = raw.replace(MODIFIER_RE, "").trim();
    if (idsOfName.has(cleaned))
      return { name: cleaned, ids: idsOfName.get(cleaned)!, matchedBy: "cleaned" };
    let best: string | undefined;
    for (let i = 0; i < raw.length; i++)
      for (let L = Math.min(longestName, raw.length - i); L >= 2; L--) {
        const sub = raw.slice(i, i + L);
        if (durationNames.has(sub) && (!best || sub.length > best.length)) best = sub;
      }
    return best
      ? { name: best, ids: idsOfName.get(best)!, matchedBy: "contained" }
      : { name: raw, ids: [], matchedBy: "exact" };
  };

  const specSpells = new Map<string, string[]>();
  for (const r of parseCsv(specSpellsRaw).rows) {
    const l = specSpells.get(r.SpellID!) ?? [];
    l.push(r.SpecID!);
    specSpells.set(r.SpellID!, l);
  }
  const specOfSpell = (id: string) => specSpells.get(id);
  const treeSpecIds = new Set(
    (talentIdMap as Array<{ specId: number }>).map((t) => String(t.specId)),
  );
  const specsOfClass = new Map<number, string[]>();
  for (const r of [...parseCsv(chrSpecRaw).rows].sort(
    (x, y) => Number(x.OrderIndex) - Number(y.OrderIndex),
  )) {
    if (!treeSpecIds.has(r.ID ?? "")) continue;
    const l = specsOfClass.get(Number(r.ClassID)) ?? [];
    l.push(r.ID!);
    specsOfClass.set(Number(r.ClassID), l);
  }

  // the talent universe: tree entries (with the specs that can take them)
  // and the PvP pool
  const specsOfTalent = new Map<string, Set<string>>();
  for (const tree of talentIdMap as Array<Record<string, unknown>>) {
    for (const g of ["classNodes", "specNodes", "heroNodes"]) {
      for (const node of (tree[g] as Array<{
        entries?: Array<{ spellId?: number }>;
      }>) ?? []) {
        for (const e of node.entries ?? []) {
          if (!e.spellId) continue;
          const s = specsOfTalent.get(String(e.spellId)) ?? new Set<string>();
          s.add(String(tree.specId));
          specsOfTalent.set(String(e.spellId), s);
        }
      }
    }
  }
  for (const [specId, granted] of Object.entries(PVP_TALENT_POOL_GENERATED))
    for (const id of Object.keys(granted)) {
      const s = specsOfTalent.get(id) ?? new Set<string>();
      s.add(specId);
      specsOfTalent.set(id, s);
    }
  const classOfTalent = talentClassMapOf(
    talentIdMap as never,
    PVP_TALENT_POOL_GENERATED,
  );
  const observed = new Set((observedSpellIds as number[]).map(String));

  const entries = new Map<string, ITalentDurationEntry>();
  const unparsed: Array<{
    talentSpellId: string;
    specs: string[];
    sentence: string;
    reason: string;
  }> = [];
  for (const [talentId, specs] of specsOfTalent) {
    const desc = descriptionOf.get(talentId);
    if (!desc || !DURATION_SENTENCE_RE.test(desc)) continue;
    const classId = classOfTalent.get(talentId)?.classId;
    const ordered =
      classId === undefined ? undefined : specsOfClass.get(classId);
    for (const specId of specs) {
      const specIndex = ordered ? ordered.indexOf(specId) : -1;
      const { text, unknown } = expandForSpec(
        desc,
        specIndex,
        specId,
        specOfSpell,
      );
      const ctx = {
        spellId: talentId,
        points: (id: string, n: number) => pointsOf.get(`${id}:${n}`),
        durationS: (id: string) => durationS.get(id),
      };
      const parsed = parseDurationClauses(text, ctx);
      for (const u of parsed.unparsed) {
        const prev = unparsed.find(
          (x) => x.talentSpellId === talentId && x.sentence === u.sentence,
        );
        if (prev) prev.specs.push(specId);
        else unparsed.push({ talentSpellId: talentId, specs: [specId], ...u });
      }
      for (const c of parsed.clauses) {
        const key = JSON.stringify([
          talentId,
          c.targets,
          c.subjectText,
          c.kind,
          c.unit,
          c.amount,
          c.cap,
          c.capUnit,
          c.trigger,
        ]);
        const prev = entries.get(key);
        if (prev) {
          prev.specs.push(specId);
          if (unknown) prev.undecidedBranch = true;
          continue;
        }
        const named = c.subjectText !== undefined
          ? (() => {
              const n = firstNameIn(c.subjectText);
              if (!n) return [];
              const r = resolveName(n);
              return [{ ...r, matchedBy: "subject" as const }];
            })()
          : c.targets.map(resolveName);
        if (named.length === 0) {
          unparsed.push({
            talentSpellId: talentId,
            specs: [specId],
            sentence: c.sentence,
            reason: "no spell name in the sentence for its implied target",
          });
          continue;
        }
        const targets = named.map(({ name, ids, matchedBy }) => {
          const withDuration = ids.filter((id) => durationS.has(id));
          return {
            name,
            matchedBy,
            spellIds: withDuration,
            observedIds: withDuration.filter((id) => observed.has(id)),
            baseSeconds: Object.fromEntries(
              withDuration.map((id) => [id, durationS.get(id)!]),
            ),
          };
        });
        entries.set(key, {
          talentSpellId: talentId,
          specs: [specId],
          kind: c.kind,
          unit: c.unit,
          amount: Math.round(c.amount * 1000) / 1000,
          ...(c.cap !== undefined ? { cap: c.cap, capUnit: c.capUnit } : {}),
          ...(c.trigger ? { trigger: c.trigger } : {}),
          sentence: c.sentence,
          ...(unknown ? { undecidedBranch: true as const } : {}),
          targets,
        });
      }
    }
  }

  const list = [...entries.values()].sort(
    (a, b) => Number(a.talentSpellId) - Number(b.talentSpellId),
  );
  // positive controls
  const has = (talent: string, pred: (e: ITalentDurationEntry) => boolean) =>
    list.some((e) => e.talentSpellId === talent && pred(e));
  const controls: Array<[string, (e: ITalentDurationEntry) => boolean]> = [
    [
      "443425",
      (e) =>
        e.kind === "per-event" &&
        e.amount === 1 &&
        e.cap === 4 &&
        e.targets.some((t) => t.spellIds.includes("79206")),
    ],
    [
      "1269310",
      (e) =>
        e.kind === "fixed" &&
        e.unit === "pct" &&
        e.targets.some((t) => t.spellIds.includes("1719")),
    ],
    [
      "327993",
      (e) =>
        e.kind === "fixed" &&
        e.unit === "s" &&
        e.targets.some((t) => t.spellIds.includes("22812")),
    ],
  ];
  for (const [id, pred] of controls)
    if (!has(id, pred))
      throw new Error(`positive control ${id} not read off its tooltip`);

  const out = {
    build,
    source:
      "zhCN Spell.Description_lang of every talent (tree + PvP pool) that says a duration is extended; lib/tooltipDurations.ts",
    entries: list,
    unparsed,
  };
  const path = new URL(
    "../../src/data/talentDurationTooltipsGenerated.json",
    import.meta.url,
  ).pathname;
  writeArtifact(path, `${JSON.stringify(out, null, 1)}\n`);
  console.log(
    `build ${build}: ${list.length} entries (${list.filter((e) => e.kind === "fixed").length} fixed, ${list.filter((e) => e.kind === "per-event").length} per-event, ${list.filter((e) => e.kind === "set").length} set), ${unparsed.length} unparsed → ${path}`,
  );
}

await main();
