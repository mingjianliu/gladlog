/**
 * Core-term glossary (spec §6.8): the zh/en pair every dictionary value that
 * names one of these terms must agree with. English reuses wording that the
 * prompt / analysis slugs / docs/user-guide.md already use wherever one exists;
 * `source` records where each English term was taken from.
 *
 * Draft — submitted for user review before the bulk string migration starts.
 * Not wired into any lookup yet; the dictionaries quote these values.
 */
export const GLOSSARY: ReadonlyArray<{
  id: string;
  zh: string;
  en: string;
  source: string;
}> = [
  // ── Finding / candidate types (findingDisplay.ts TYPE_LABEL; slug = candidate type) ──
  {
    id: "type.death",
    zh: "死亡",
    en: "Death",
    source: "candidate type slug `death`; prompt tag [DEATH]",
  },
  {
    id: "type.death-setup",
    zh: "死亡铺垫",
    en: "Death setup",
    source: "candidate type slug `death-setup`",
  },
  {
    id: "type.cd-waste",
    zh: "整场未用",
    en: "Never used this round",
    source:
      'candidate type `cd-waste`; prompt legend "never successfully cast in this round"',
  },
  {
    id: "type.missed-cleanse",
    zh: "漏解",
    en: "Missed cleanse",
    source: "candidate type slug `missed-cleanse`",
  },
  {
    id: "type.missed-purge",
    zh: "漏偷",
    en: "Missed purge",
    source: "candidate type slug `missed-purge`; prompt tag [MISSED PURGE]",
  },
  {
    id: "type.kick-eaten",
    zh: "施法被断",
    en: "Cast interrupted",
    source:
      'candidate type `kick-eaten`; prompt legend "your hardcast was interrupted"',
  },
  {
    id: "type.burst-into-mitigation",
    zh: "打进大减伤",
    en: "Burst into mitigation",
    source: "candidate type slug `burst-into-mitigation`",
  },
  {
    id: "type.external-unused",
    zh: "外减可用未给",
    en: "External not given",
    source:
      'candidate type `external-unused`; prompt legend "had external defensive off cooldown"',
  },
  {
    id: "type.healing-gap",
    zh: "治疗空窗",
    en: "Healing gap",
    source: "candidate type slug `healing-gap`",
  },
  {
    id: "type.position-mistake",
    zh: "走位失误",
    en: "Positioning mistake",
    source: "candidate type slug `position-mistake`",
  },
  {
    id: "type.cc-held",
    zh: "压手未放",
    en: "CC held",
    source: "candidate type slug `cc-held`",
  },
  {
    id: "type.cc-avoidable",
    zh: "规避手段可用未用",
    en: "Avoidable CC",
    source: "candidate type slug `cc-avoidable`",
  },
  {
    id: "type.slow-defensive-response",
    zh: "敌方开大应对迟缓",
    en: "Slow defensive response",
    source: "candidate type slug `slow-defensive-response`",
  },
  {
    id: "type.crisis-no-response",
    zh: "危机无应对",
    en: "No response to crisis",
    source: "candidate type slug `crisis-no-response`",
  },
  {
    id: "type.teammate-crisis-idle",
    zh: "队友危机未出手",
    en: "Idle during teammate crisis",
    source: "candidate type slug `teammate-crisis-idle`",
  },
  {
    id: "type.teammate-crisis-triage",
    zh: "队友危机救错人",
    en: "Wrong triage in teammate crisis",
    source: "candidate type slug `teammate-crisis-triage`",
  },
  {
    id: "type.backlash-dispel",
    zh: "解反噬 DoT",
    en: "Backlash dispel",
    source:
      "candidate type slug `backlash-dispel`; prompt tag [DISPEL BACKLASH CC]",
  },
  {
    id: "type.backlash-dispel-window",
    zh: "可解未解",
    en: "Dispel window missed",
    source:
      'candidate type `backlash-dispel-window`; prompt legend "cleanse ready, and no dispel came"',
  },
  {
    id: "type.kick-priority-missed",
    zh: "该踢没踢",
    en: "Priority kick missed",
    source: "candidate type slug `kick-priority-missed`",
  },
  {
    id: "type.kick-priority-team",
    zh: "队友能踢",
    en: "Teammate could kick",
    source:
      "candidate type `kick-priority-team`; prompt legend (kick available on a teammate)",
  },

  // ── Finding categories (findingDisplay.ts CATEGORY_ZH; analysis FINDING_CATEGORIES) ──
  {
    id: "category.survival",
    zh: "生存",
    en: "Survival",
    source: "FindingCategory slug `survival`",
  },
  {
    id: "category.cooldowns",
    zh: "冷却使用",
    en: "Cooldowns",
    source: "FindingCategory slug `cooldowns`",
  },
  {
    id: "category.positioning",
    zh: "站位",
    en: "Positioning",
    source: "FindingCategory slug `positioning`",
  },
  {
    id: "category.target-selection",
    zh: "目标选择",
    en: "Target selection",
    source: "FindingCategory slug `target-selection`",
  },
  {
    id: "category.cc",
    zh: "控制",
    en: "CC",
    source: "FindingCategory slug `cc`; prompt tags [CC] / [CC ON TEAM]",
  },
  {
    id: "category.interrupts",
    zh: "打断",
    en: "Interrupts",
    source:
      'FindingCategory slug `interrupts`; user-guide Match report view ("interrupts cast")',
  },
  {
    id: "category.dispels",
    zh: "驱散",
    en: "Dispels",
    source:
      'FindingCategory slug `dispels`; user-guide Match report view ("dispels")',
  },
  {
    id: "category.offense",
    zh: "进攻",
    en: "Offense",
    source: "FindingCategory slug `offense`",
  },

  // ── Severity (findingDisplay.ts SEV_ZH; Finding.severity enum high|med|low) ──
  {
    id: "severity.high",
    zh: "高",
    en: "High",
    source: "Finding.severity enum `high`",
  },
  {
    id: "severity.med",
    zh: "中",
    en: "Medium",
    source: "Finding.severity enum `med`",
  },
  {
    id: "severity.low",
    zh: "低",
    en: "Low",
    source: "Finding.severity enum `low`",
  },

  // ── Kick outcomes (kickText.ts MISSED_KICK_TEXT / REFUSED_KICK_TEXT; analysis MissedKickKind) ──
  {
    id: "kick.missed",
    zh: "落空",
    en: "Missed",
    source: "analysis MissedKickKind `missed`",
  },
  {
    id: "kick.immune",
    zh: "目标免疫打断",
    en: "Target immune to interrupt",
    source: "analysis MissedKickKind `immune` (log miss type IMMUNE)",
  },
  {
    id: "kick.reflected",
    zh: "被目标反射",
    en: "Reflected by target",
    source: "analysis MissedKickKind `reflected` (log miss type REFLECT)",
  },

  // ── Settings concepts (SettingsPanel.tsx; user-guide § Settings) ──
  {
    id: "settings.wowFolder",
    zh: "WoW 目录",
    en: "WoW folder",
    source: 'user-guide § Settings ("WoW folder")',
  },
  {
    id: "settings.uiZoom",
    zh: "界面缩放",
    en: "UI zoom",
    source: "SettingsPanel (no existing English wording)",
  },
  {
    id: "settings.aiAnalysis",
    zh: "AI 分析",
    en: "AI analysis",
    source: "user-guide § AI analysis view",
  },
  {
    id: "settings.aiBackend",
    zh: "AI 后端",
    en: "AI backend",
    source: 'user-guide § Settings ("AI backend")',
  },
  {
    id: "settings.apiKey",
    zh: "API key",
    en: "API key",
    source: 'user-guide § Settings ("API key")',
  },
  {
    id: "settings.model",
    zh: "模型",
    en: "Model",
    source: 'user-guide § Settings ("model dropdown")',
  },
  {
    id: "settings.commandPath",
    zh: "命令路径",
    en: "Command path",
    source: 'user-guide § Settings ("the command path is auto-detected")',
  },
  {
    id: "settings.coachReplyLanguage",
    zh: "教练回复语言",
    en: "Coach reply language",
    source: 'user-guide § Settings ("Coach reply language")',
  },
  {
    id: "settings.autoAnalyze",
    zh: "自动分析新对局",
    en: "Auto-analyze new matches",
    source: "SettingsPanel (no existing English wording)",
  },
  {
    id: "settings.aiSelfReview",
    zh: "AI 自查",
    en: "AI self-review",
    source: 'user-guide § Settings ("AI self-review")',
  },
  {
    id: "settings.aiSelfReviewed",
    zh: "已 AI 自查",
    en: "AI self-reviewed",
    source:
      'user-guide § Settings (result marker; English derived from "AI self-review")',
  },
  {
    id: "settings.notSelfReviewed",
    zh: "未自查",
    en: "Not self-reviewed",
    source:
      'user-guide § Settings (result marker; English derived from "AI self-review")',
  },
  {
    id: "settings.recording",
    zh: "对局录像(OBS)",
    en: "Match recording (OBS)",
    source: "SettingsPanel (no existing English wording)",
  },
  {
    id: "settings.recordingMode",
    zh: "录像模式",
    en: "Recording mode",
    source: "SettingsPanel (no existing English wording)",
  },
  {
    id: "settings.managedObs",
    zh: "托管 OBS",
    en: "Managed OBS",
    source: "SettingsPanel (no existing English wording)",
  },
  {
    id: "settings.ownObs",
    zh: "自有 OBS",
    en: "Your own OBS",
    source: "SettingsPanel (no existing English wording)",
  },
  {
    id: "settings.autoRecord",
    zh: "自动录像",
    en: "Auto-record",
    source: "SettingsPanel (no existing English wording)",
  },

  // ── Report / app concepts (user-guide sections) ──
  {
    id: "report.meter.damage",
    zh: "伤害",
    en: "Damage",
    source: "user-guide § Match report view (meter modes)",
  },
  {
    id: "report.meter.healing",
    zh: "治疗",
    en: "Healing",
    source: "user-guide § Match report view (meter modes)",
  },
  {
    id: "report.meter.damageTaken",
    zh: "承伤",
    en: "Damage taken",
    source: "user-guide § Match report view (meter modes)",
  },
  {
    id: "report.meter.stats",
    zh: "统计",
    en: "Stats",
    source: "user-guide § Match report view (meter modes)",
  },
  {
    id: "report.deathRecap",
    zh: "死亡回顾",
    en: "Death recap",
    source: 'user-guide § Match report view ("Death recap")',
  },
  {
    id: "report.killWindow",
    zh: "击杀窗口",
    en: "Kill window",
    source:
      'prompt (`facts.inKillWindow`, "your team\'s kill window"); user-guide uses "kill attempts" for the HP-curve band',
  },
  {
    id: "report.replay",
    zh: "回放",
    en: "Replay",
    source: "user-guide § Replay view",
  },
  {
    id: "report.dampening",
    zh: "衰减",
    en: "Dampening",
    source: 'user-guide § Replay view ("dampening")',
  },
  {
    id: "report.finding",
    zh: "失误",
    en: "Finding",
    source: 'user-guide § AI analysis view ("findings"); prompt `Finding`',
  },
  {
    id: "report.followup.improved",
    zh: "已改进",
    en: "Fixed",
    source: 'user-guide § AI analysis view ("✓ fixed")',
  },
  {
    id: "report.followup.stillDoing",
    zh: "还在犯",
    en: "Still doing it",
    source: 'user-guide § AI analysis view ("↻ still doing it")',
  },
];
