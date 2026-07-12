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
export interface Finding extends RawFinding {} // explanation is interpolated post-audit
export interface AuditResult {
  findings: Finding[];
  dropped: Array<{ finding: RawFinding; reason: string }>;
}
