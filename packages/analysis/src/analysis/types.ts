export interface CandidateEvent {
  id: string;
  type: string; // "death" | "cd-waste" | ... (extensible)
  t: number; // seconds from combat start
  unitNames: string[];
  spell?: string;
  /**
   * 技能 id(字符串,与全仓一致)。纯展示用:UI 拿它查 SPELL_ICONS_GENERATED
   * 出图标。**不进 prompt、不进 facts**,所以不受门规审计约束 —— 多技能事件
   * (如连续爆发 CD)只取首个,图标是标识不是断言。
   */
  spellId?: string;
  facts: Record<string, string>; // verifiable, formatted; the only values a finding may cite
}
export interface RawFinding {
  eventIds: string[];
  severity: "high" | "med" | "low";
  category: string;
  title: string;
  explanation: string;
}
export interface Finding extends RawFinding {
  /** 深挖轮产物(自动追问):审计通过的叙述 + 证据 chips(相对秒,可跳回放)。 */
  deepDive?: {
    text: string;
    chips: Array<{
      t: number;
      label: string;
      unitNames: string[];
      /** 仅供 UI 出图标(SPELL_ICONS_GENERATED);无单一技能的条目留空。 */
      spellId?: string;
    }>;
  };
} // explanation is interpolated post-audit
export interface AuditResult {
  findings: Finding[];
  dropped: Array<{ finding: RawFinding; reason: string }>;
}
