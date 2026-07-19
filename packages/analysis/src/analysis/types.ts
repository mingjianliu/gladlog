export interface CandidateEvent {
  id: string;
  type: string; // "death" | "cd-waste" | ... (extensible)
  t: number; // seconds from combat start
  unitNames: string[];
  spell?: string;
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
    chips: Array<{ t: number; label: string; unitNames: string[] }>;
  };
} // explanation is interpolated post-audit
export interface AuditResult {
  findings: Finding[];
  dropped: Array<{ finding: RawFinding; reason: string }>;
}
