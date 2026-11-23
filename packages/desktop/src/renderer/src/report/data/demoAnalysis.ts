import type { Finding } from "@gladlog/analysis";

/**
 * The demo analysis shown by 「看一个演示分析」on the AI tab when no backend
 * is configured (UI review 2026-08-21 #7), and the payload the dev/visual
 * fixture bridge serves for the report-ai scene — one object, so the shipped
 * demo and the visual baseline can never drift. Hand-written, anonymised by
 * construction (unit names are roles), ~1.5 KB.
 *
 * Fence: this is never written to the analysis cache, never shown to the
 * coach chat, and its ▶ seeks are disabled — the repo already treats fake
 * findings beside a real match as a hazard (dev/main.tsx strips them in
 * blind-review mode).
 */
export const DEMO_ANALYSIS = {
  findings: [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "survival",
      title: "被集火秒杀",
      explanation:
        "敌方双 DPS 进攻 CD 对齐时,你在没有减伤/位移的情况下于 1.4s 内掉血 82% 后阵亡;此前贴在开阔地带、离掩体较远。",
      deepDive: {
        text: "在 2:08 你的治疗吃了 4 秒恐惧且饰品在 CD;2:10 敌方战士开天神下凡;你的 HP 从 T-15s 的 86% 一路掉到 T-5s 的 41%。下次看到治疗被控且无解时,提前一个 GCD 交墙或拉向立柱。",
        chips: [
          { t: 128, label: "恐惧 → 治疗(4.0s)", unitNames: ["Healer"] },
          { t: 130, label: "敌 天神下凡(Warr)", unitNames: ["Warr"] },
        ],
      },
    },
    {
      eventIds: ["e2"],
      severity: "med",
      category: "cooldowns",
      title: "防御 CD 留手:Tranquility 未使用",
      explanation:
        "整场保留了 Tranquility 未用即阵亡——对面 Restoration Druid 在 0:33 交出 Ironbark 后,你本应在承伤窗口用 Power Word: Shield 或 Renew's 持续回复顶住并读出 Tranquility。",
    },
    {
      eventIds: ["e3"],
      severity: "low",
      category: "positioning",
      title: "站位偏开阔",
      explanation: "多数时间停留在中场开阔区,较少利用立柱拉视线。",
    },
  ] as unknown as Finding[],
  dropped: 0,
  hadNarration: true,
  // Prevents the deep-dive follow-up from triggering a loop in fixture mode.
  deepened: true,
};

/**
 * The English twin of DEMO_ANALYSIS, shown by the same button when the UI
 * language is en (an English user must not get Chinese findings). Same shape
 * and the same three findings, worded in English with the glossary's terms.
 * The visual baseline keeps using the zh object.
 */
export const DEMO_ANALYSIS_EN: typeof DEMO_ANALYSIS = {
  findings: [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "survival",
      title: "Focused down",
      explanation:
        "When both enemy DPS lined up their offensive cooldowns, you lost 82% HP in 1.4s with no defensive or movement ability used and died; before that you had been standing in the open, far from cover.",
      deepDive: {
        text: "At 2:08 your healer ate a 4-second Fear with their trinket on cooldown; at 2:10 the enemy Warrior pressed Avatar; your HP fell from 86% at T-15s to 41% at T-5s. Next time your healer is CC'd with no way out, press a wall or move to a pillar one GCD earlier.",
        chips: [
          { t: 128, label: "Fear → healer (4.0s)", unitNames: ["Healer"] },
          { t: 130, label: "Enemy Avatar (Warr)", unitNames: ["Warr"] },
        ],
      },
    },
    {
      eventIds: ["e2"],
      severity: "med",
      category: "cooldowns",
      title: "Defensive held: Tranquility never used",
      explanation:
        "You held Tranquility all match and died without using it. After the enemy Restoration Druid gave up Ironbark at 0:33, you should have held the damage window with Power Word: Shield or Renew's healing over time and channelled Tranquility.",
    },
    {
      eventIds: ["e3"],
      severity: "low",
      category: "positioning",
      title: "Standing in the open",
      explanation:
        "You spent most of the match in the open middle of the arena and rarely used pillars to break line of sight.",
    },
  ] as unknown as Finding[],
  dropped: 0,
  hadNarration: true,
  deepened: true,
};
