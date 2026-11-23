import type { MessageParams } from "../index";

// English dictionary for the `matchList.*` namespace. Must mirror
// zh/matchList.ts key-for-key (enforced by `satisfies Messages` in en/index.ts).
const matches = (n: unknown): string =>
  Number(n) === 1 ? "1 match" : `${n} matches`;

export const enMatchList = {
  "matchList.group.today": "Today",
  "matchList.group.yesterday": "Yesterday",
  "matchList.group.summary": (p: MessageParams) =>
    `${matches(p.n)} · ${p.wins}-${p.losses}`,
  "matchList.loadingMore": "Loading more in the background…",
  "matchList.roundLabel": "Round {i}/{n}",
  "matchList.check.shuffle":
    "Check to add the whole shuffle (all 6 rounds) to batch analysis",
  "matchList.check.match": "Check to add to batch analysis",
  "matchList.splitterAria": "Resize the match list",
  "matchList.filter.all": "All",
  "matchList.filter.win": "Win",
  "matchList.filter.loss": "Loss",
  "matchList.filter.bracketTitle": "Bracket",
  "matchList.filter.allBrackets": "All brackets",
  "matchList.filter.specTitle":
    "Add a spec (pick several to search for one team's comp)",
  "matchList.filter.allSpecs": "All specs",
  "matchList.filter.addSpec": "+ Spec (same team)",
  "matchList.filter.removeSpec": "Remove {spec}",
  "matchList.filter.removeZone": "Remove map filter",
  "matchList.filter.dateFrom": "Start date",
  "matchList.filter.dateTo": "End date",
  "matchList.filter.clear": "Clear",
  "matchList.import.button": "Import historical logs…",
  "matchList.import.busy": "Importing…",
  "matchList.import.progress":
    "Parsing {i}/{n}: {file} ({stored} new{dupPart})",
  "matchList.import.progressDup": (p: MessageParams) =>
    `, ${p.dup} ${Number(p.dup) === 1 ? "duplicate" : "duplicates"}`,
  "matchList.import.done": (p: MessageParams) =>
    `Done: ${Number(p.files) === 1 ? "1 file" : `${p.files} files`}, ${matches(p.stored)} added, ${p.dup} ${Number(p.dup) === 1 ? "duplicate" : "duplicates"} skipped${p.failedPart}`,
  "matchList.import.doneFailed": (p: MessageParams) =>
    `, ${Number(p.failed) === 1 ? "1 file" : `${p.failed} files`} failed`,
  "matchList.import.failed": "Import failed: {error}",
};
