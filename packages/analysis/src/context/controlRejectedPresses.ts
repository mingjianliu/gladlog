/**
 * The log owner's major-cooldown presses the game refused BECAUSE they were
 * controlled or silenced, stated on the control's own line (FT-T16, user
 * decision D13 = option 1d, 2026-10-10: "attach to the existing CC line, add
 * no line"):
 *
 *   0:20  [CC ON TEAM]   1(DPriest) ← Rake (by 3(FDruid)) | 6s … | pressed during it: Fade ×15, Psychic Scream ×4
 *
 * 6062daf2 (the decision's example): a Discipline Priest stunned for 6 s
 * pressed Fade 15 times and Psychic Scream 4 times into the stun, and the
 * prompt said only that the Scream came "7.0 s" after the burst.
 *
 * What is read: `SPELL_CAST_FAILED` rows of the raw stream (`rawStreams.ts` —
 * the reader of `[REJECTED]` and of cd-hoarded's `attempted`). Only the log's
 * recorder has such rows, so no other player ever gets the note. The
 * `[REJECTED]` line family (ruling 2026-09-26: range / movement / line of
 * sight, outside control) is unchanged and reads none of this.
 *
 * What is NOT read: a press refused as "not ready" (own cooldown / GCD —
 * `NOT_READY_REASONS`, 72–78 % of all refused presses, key repeat for the most
 * part) and any reason outside the table below.
 */
import { cdIsProcOnly } from "../utils/cooldowns";
import type { CastFailedEvent } from "../utils/rawStreams";

/** `control` = a loss of control (stun, fear, incapacitate, polymorph,
 *  banish, …), stated on `[CC ON TEAM]`; `silence` = stated on `[SILENCE]`
 *  (a silence never renders as `[CC ON TEAM]`). */
export type ControlRejectKind = "control" | "silence";

/**
 * SPELL_CAST_FAILED reason texts that say "you are controlled" / "you are
 * silenced", for every client locale the corpus carries. The texts are the
 * client's own strings, copied from the logs — not translations.
 *
 * Hand table of STRINGS (no spell id in it, so `curatedIdRegistry` — spell
 * ids only — cannot hold it). Forward check (Curated-List Completeness Rule,
 * 2026-10-10): every SPELL_CAST_FAILED reason on 665 raw files (the 605-file
 * new-season capture + the 60 re-evaluation rounds), 344,045 rows, 340
 * distinct texts, each one read and classed. In the table: 105 texts, 32,459
 * rows (control 95 texts / 29,862 rows, silence 10 / 2,597), every one of
 * them seen in those files. Every other text is another class —
 * not ready, range / movement / line of sight (`REJECT_REASONS`), interrupted,
 * resource, target, weapon, facing, stealth / form / combat state — or one of
 * these, read and left out on purpose:
 *
 *  - "Can't do that while invulnerable" (155) / "无法在无敌时那样做" (3): the
 *    player's own immunity (Ice Block), not a control.
 *  - "Can't use that ability while pacified" (51) / "不能在平靜狀態使用這個能力"
 *    (2): a pacify is on no `[CC ON TEAM]` / `[SILENCE]` line.
 *  - "You are unable to move" (174) / "你无法移动" (26): a root — only movement
 *    abilities are refused, and a root is no `[CC ON TEAM]` line.
 *  - "You can't do that right now." (1,171) and its de / fr / ko forms (36),
 *    "You can't take actions right now." (1): no cause stated.
 *  - "지금은 몸을 제대로 가눌 수 없습니다." (4, one file): probably the ko "not in
 *    control of your actions"; not confirmed against the client strings.
 *
 * it-IT has no press in those files and is not listed. A text missing here
 * only loses a note (the press is not stated); it can never state a false one.
 */
export const CONTROL_REJECT_REASONS: Readonly<
  Record<ControlRejectKind, readonly string[]>
> = {
  control: [
    // en — "Can't do that while <mechanic>", plus the three older forms
    "Can't do that while stunned",
    "Can't do that while fleeing",
    "Can't do that while disoriented",
    "Can't do that while frozen", // Freezing Trap, Ring of Frost
    "Can't do that while polymorphed",
    "Can't do that while banished", // Cyclone
    "Can't do that while incapacitated",
    "Can't do that while horrified",
    "Can't do that while sapped",
    "Can't do that while asleep",
    "Can't do that while charmed",
    "Can't do that while confused",
    "You are not in control of your actions",
    "You are possessed",
    // zh-CN
    "无法在昏迷时那样做",
    "无法在逃跑时那样做",
    "无法在迷惑时那样做",
    "无法在变形时那样做",
    "无法在冻结时那样做",
    "无法在放逐时那样做",
    "无法在瘫痪时那样做",
    "无法在沉睡时那样做",
    "无法在惊骇时那样做",
    "无法在闷棍时那样做",
    "无法在魅惑时那样做",
    "不能在昏迷状态实施该动作",
    "无法在逃跑状态下那样做",
    "无法在混乱状态下那样做",
    "你无法控制你自己的动作",
    "你被占据了",
    // zh-TW
    "無法在昏迷狀態下這麼做",
    "無法在逃跑狀態下這麼做",
    "無法在困惑狀態下這麼做",
    "無法在恐懼狀態下這麼做",
    "無法在沉睡狀態下這麼做",
    "無法在變形狀態下這麼做",
    "無法在癱瘓狀態下這麼做",
    "不能在昏迷狀態執行該動作",
    "無法在逃跑狀態下那樣做",
    // ko
    "기절 중에는 불가능합니다.",
    "도망 중에는 불가능합니다.",
    "얼어 붙음 중에는 불가능합니다.",
    "수면 중에는 불가능합니다.",
    "행동 불가 중에는 불가능합니다.",
    "방향 감각 상실 중에는 불가능합니다.",
    "의식 불명 중에는 불가능합니다.",
    "극심한 공포 중에는 불가능합니다.",
    // es
    "No puedes hacer eso mientras estás aturdido",
    "No puedes hacer eso mientras estás huyendo",
    "No puedes hacer eso mientras estás polimorfado",
    "No puedes hacer eso mientras estás embelesado",
    "No puedes hacer eso mientras estás congelado",
    "No puedes hacer eso mientras estás aporreado",
    "No puedes hacer eso mientras estás desorientado",
    "No puedes hacer eso mientras estás confundido",
    "No puedes hacer eso durante el embelesamiento",
    "No controlas tus acciones",
    "Te han poseído",
    // fr
    "Impossible lorsque vous êtes étourdi(e)",
    "Impossible lorsque vous êtes métamorphosé(e)",
    "Impossible lorsque vous êtes endormi(e)",
    "Impossible lorsque vous êtes en fuite",
    "Impossible lorsque vous êtes désorienté(e)",
    "Impossible lorsque vous êtes stupéfié(e)",
    "Impossible lorsque vous êtes gelé(e)",
    "Impossible quand étourdi(e)",
    "Impossible sous Confusion",
    // de
    "Das geht nicht, während Euer Status 'betäubt' ist.",
    "Das geht nicht, während Euer Status 'verbannt' ist.",
    "Das geht nicht, während Euer Status 'verwandelt' ist.",
    "Das geht nicht, während Euer Status 'eingefroren' ist.",
    "Das geht nicht, während Euer Status 'fliehend' ist.",
    "Das geht nicht, während Euer Status 'ausgeschaltet' ist.",
    "Das ist im betäubten Zustand nicht möglich.",
    "Ihr seid nicht für Eure Handlungen verantwortlich.",
    // ru
    "Действие невозможно. Причина: оглушение.",
    "Действие невозможно. Причина: паника.",
    "Действие невозможно. Причина: превращение.",
    "Действие невозможно. Причина: изгнание.",
    "Действие невозможно. Причина: ужас.",
    "Действие невозможно. Причина: дезориентация.",
    "Действие невозможно. Причина: паралич.",
    "Действие невозможно. Причина: ошеломление.",
    "Вы оглушены и не можете этого сделать.",
    "Вы в замешательстве и не можете этого сделать.",
    "Вы не можете контролировать свои действия.",
    // pt
    "Você não pode fazer isto enquanto estiver atordoado",
    "Você não pode fazer isto enquanto estiver fugindo",
    "Você não pode fazer isto enquanto estiver desnorteado",
    "Você não pode fazer isto enquanto estiver congelado",
    "Você não pode fazer isto enquanto estiver incapacitado",
    "Você não pode fazer isto enquanto estiver enfeitiçado",
    "Você não pode fazer isso quando está fugindo",
    "Você não controla suas ações",
    "Você está possuído",
  ],
  silence: [
    "Can't do that while silenced",
    "无法在沉默时那样做",
    "不能在沉默状态中实施该动作",
    "不能在沉默狀態中執行該動作",
    "침묵 중에는 불가능합니다.",
    "No puedes hacer eso mientras estás silenciado",
    "Impossible lorsque réduit au silence",
    "Das geht nicht, während Euer Status 'zum Schweigen gebracht' ist.",
    "Das geht nicht, wenn Ihr zum Schweigen gebracht wurdet.",
    "Действие невозможно. Причина: немота.",
  ],
};

const KIND_OF = new Map<string, ControlRejectKind>(
  (
    Object.entries(CONTROL_REJECT_REASONS) as [
      ControlRejectKind,
      readonly string[],
    ][]
  ).flatMap(([k, texts]) => texts.map((t) => [t, k] as const)),
);

/** The kind of control a SPELL_CAST_FAILED reason states, if it states one. */
export function controlRejectKindOf(
  reason: string,
): ControlRejectKind | undefined {
  return KIND_OF.get(reason);
}

export interface IPressedDuringControl {
  spellId: string;
  /** the cooldown's name as the owner's `<cooldowns>` kit prints it */
  spellName: string;
  count: number;
  firstSeconds: number;
}

/** A rendered control on the owner: `[fromSeconds, toSeconds]`,
 *  match-relative (the clock of `castFailed`). */
export interface IControlWindow {
  fromSeconds: number;
  toSeconds: number;
}

/** Spell id → name of the owner's cooldown ledger (the `<cooldowns>` kit),
 *  without the entries that have no button (`cdIsProcOnly`: the kit prints
 *  them `[PASSIVE]`). What a `pressed during it:` clause may name — the
 *  decision is about major cooldowns, not every button. */
export function ownerControlPressKit(
  ownerCDs: ReadonlyArray<{
    spellId: string;
    spellName: string;
    isProcOnly?: boolean;
  }>,
): Map<string, string> {
  return new Map(
    ownerCDs
      .filter((cd) => !cdIsProcOnly(cd))
      .map((cd) => [cd.spellId, cd.spellName] as const),
  );
}

/**
 * Per rendered control (`windows`, read through `spanOf`), the owner's kit
 * cooldowns pressed inside it and refused for a reason of `kind`, in order of
 * first press.
 *
 *  - a press belongs to ONE window: the earliest-started one that holds it
 *    (two controls overlapping do not both claim it). Bounds are inclusive,
 *    compared in whole milliseconds, the log's own grid.
 *  - no count threshold: one refused press of a save is the fact.
 *
 * A press outside every window (a control with no line — a zero-length one, a
 * pacify) is stated nowhere.
 */
export function ownerPressesRejectedDuring<W>(
  castFailed: readonly CastFailedEvent[],
  ownerId: string,
  kit: ReadonlyMap<string, string>,
  kind: ControlRejectKind,
  windows: readonly W[],
  spanOf: (w: W) => IControlWindow,
): Map<W, IPressedDuringControl[]> {
  const out = new Map<W, IPressedDuringControl[]>();
  if (windows.length === 0 || kit.size === 0) return out;
  const ms = (s: number) => Math.round(s * 1000);
  const ordered = windows
    .map((w) => {
      const span = spanOf(w);
      return { w, fromMs: ms(span.fromSeconds), toMs: ms(span.toSeconds) };
    })
    .sort((a, b) => a.fromMs - b.fromMs);
  const hits = castFailed
    .filter(
      (h) =>
        h.unitGuid === ownerId &&
        kit.has(String(h.spellId)) &&
        KIND_OF.get(h.reason) === kind,
    )
    .sort((a, b) => a.tSeconds - b.tSeconds);
  for (const h of hits) {
    const t = ms(h.tSeconds);
    const held = ordered.find((x) => x.fromMs <= t && t <= x.toMs);
    if (!held) continue;
    const id = String(h.spellId);
    const spellName = kit.get(id)!;
    const list = out.get(held.w) ?? [];
    // by the printed name: two kit ids that print one name are one item (the
    // gate reads names)
    const cur = list.find((p) => p.spellName === spellName);
    if (cur) cur.count++;
    else
      list.push({ spellId: id, spellName, count: 1, firstSeconds: h.tSeconds });
    out.set(held.w, list);
  }
  return out;
}

/** The clause's fixed head — also what the legend looks for. */
export const PRESSED_DURING_NOTE_HEAD = " | pressed during it: ";

/** ` | pressed during it: Desperate Prayer ×12, Fade ×3`; "" for none. Always
 *  the last clause of its line. */
export function formatPressedDuringNote(
  presses: readonly IPressedDuringControl[] | undefined,
): string {
  return presses?.length
    ? `${PRESSED_DURING_NOTE_HEAD}${presses.map((p) => `${p.spellName} ×${p.count}`).join(", ")}`
    : "";
}

/** A control line without its `pressed during it:` clause (always the last
 *  one). For a reader that looks for the CONTROL's name in the line's text
 *  (`resLedgerPrune`): the clause names the owner's own cooldowns, and a
 *  priest's refused Psychic Scream is not a Psychic Scream on anyone. */
export function stripPressedDuringNote(line: string): string {
  const i = line.indexOf(PRESSED_DURING_NOTE_HEAD);
  return i < 0 ? line : line.slice(0, i);
}

/** The clause as the gate re-parses it (`checkPressedDuringControlNote`):
 *  group 1 = the `Name ×N, Name ×N` list, anchored at the end of the line. A
 *  name can hold a comma (Invoke Xuen, the White Tiger), so an item ends at
 *  its ` ×N`, not at a comma. */
export const PRESSED_DURING_NOTE_RE_SRC = String.raw` \| pressed during it: ((?:[^|×]+ ×\d+)(?:, [^|×]+ ×\d+)*)$`;
/** One `Name ×N` item of that list: group 1 = the name, group 2 = the count. */
export const PRESSED_DURING_ITEM_RE_SRC = String.raw`(.+?) ×(\d+)(?:, |$)`;
