# gladlog documentation map

**English** · [Chinese](README.zh-CN.md)

Where to look, and how much to trust what you find. The hard rules themselves live in `CLAUDE.md` at the repo root; this page only says which document holds what.

## Canonical (kept current)

These are bilingual — English is the canonical version, the `.zh-CN.md` twin must say the same thing (the "Bilingual Docs Rule" in `CLAUDE.md`). A language bar sits under every H1.

| Document                                                           | What it is                                                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [`../README.md`](../README.md)                                     | Product overview and quick start                                                                   |
| [`../CHANGELOG.md`](../CHANGELOG.md)                               | Release notes                                                                                      |
| [`user-guide.md`](user-guide.md)                                   | Using the desktop app                                                                              |
| [`FAQ.md`](FAQ.md)                                                 | Frequently asked questions                                                                         |
| [`setup-windows-claude-cli.md`](setup-windows-claude-cli.md)       | Windows setup for the AI coach through the Claude CLI (no API key)                                 |
| [`developer-guide.md`](developer-guide.md)                         | Reading and modifying the codebase: dependencies, loop, tests, eval, language policy               |
| [`architecture.md`](architecture.md)                               | Packages, processes, data flow, and the places that bite                                           |
| [`BUILD-WINDOWS.md`](BUILD-WINDOWS.md)                             | Building the Windows installer                                                                     |
| [`verifiability-roadmap.md`](verifiability-roadmap.md)             | The verification system as a whole                                                                 |
| [`DATA-COMPLIANCE.md`](DATA-COMPLIANCE.md)                         | Data and licensing provenance                                                                      |
| [`pvp-log-archive.md`](pvp-log-archive.md)                         | Long-term PvP log archive                                                                          |
| [`predicate-index.md`](predicate-index.md)                         | Where every shared predicate lives (analysis ↔ gate ↔ report UI); CI-checked                       |
| [`log-observability-audit.md`](log-observability-audit.md)         | What the combat log can and cannot observe                                                         |
| [`rule-history.md`](rule-history.md)                               | Rule history (incident narratives behind CLAUDE.md rules)                                          |

Package READMEs follow the same rule — `packages/<pkg>/README.md` is canonical, `README.zh-CN.md` is its twin:
[`analysis`](../packages/analysis/README.md) ·
[`desktop`](../packages/desktop/README.md) ·
[`parser`](../packages/parser/README.md) ·
[`parser-compat`](../packages/parser-compat/README.md) ·
[`eval`](../packages/eval/README.md) ·
[`corpus-tools`](../packages/corpus-tools/README.md) ·
[`log-pipeline`](../packages/log-pipeline/README.md).

## Runbooks (`docs/commands/`)

One page per repeatable workflow; most are also exposed as `/<name>` skills.

| Runbook                                                    | One line                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`eval-baseline.md`](commands/eval-baseline.md)            | Score healer prompt/response quality across matches and report what to fix                                        |
| [`eval-ab.md`](commands/eval-ab.md)                        | Controlled blind A/B of a prompt-builder change (same corpus, paired statistics)                                   |
| [`calibrate-judge.md`](commands/calibrate-judge.md)        | Calibrate the LLM judge against planted synthetic defects before trusting its scores                              |
| [`pipeline-audit.md`](commands/pipeline-audit.md)          | Full-corpus two-layer audit: deterministic prompt-vs-log gates plus calibrated judging                            |
| [`deepdive-probe.md`](commands/deepdive-probe.md)          | Unlimited-budget agent deep dive on one real match, blind-mixed against the product baseline                      |
| [`outcome-halo.md`](commands/outcome-halo.md)              | One-off 2026-08-05 judge outcome-halo experiment, kept only so it stays reproducible                              |
| [`update-wow-data.md`](commands/update-wow-data.md)        | Refresh generated game data (spells, talents, trinkets) from wago.tools when a build ships; season health checks  |
| [`collect-logs.md`](commands/collect-logs.md)              | The four combat-log collection channels (local, cross-machine relay, public feed, Drive archive)                  |
| [`ingest-coach-corpus.md`](commands/ingest-coach-corpus.md) | Turn coaching-site VoD reviews into a corpus reconciled against gladlog's candidate predicates                    |
| [`release-gladlog.md`](commands/release-gladlog.md)        | Cut a desktop release (the authoritative flow is the `release` skill; this page holds the footer and failure playbook) |

## Audits & inventories

Living reference material; each states its own measurement date.

- [`coaching-grounding-audit.md`](coaching-grounding-audit.md) — per-signal grounding provenance for every coaching judgment.
- [`log-observability-audit.md`](log-observability-audit.md) — which facts the combat log exposes (bilingual, see above).
- [`ability-fact-inventory.md`](ability-fact-inventory.md) — the ability facts the prompt renders and where each comes from.
- [`predicate-index.md`](predicate-index.md) — the shared-predicate registry (bilingual, see above).
- [`coach-corpus-admission-audit-2026-09-12.md`](coach-corpus-admission-audit-2026-09-12.md) — the admission audit of the Skill Capped coach corpus.

## Backlog

- [`BACKLOG.md`](BACKLOG.md) — open items and the rulings attached to them.
- [`BACKLOG-archive.md`](BACKLOG-archive.md) — closed items, kept for the anchors other docs cite.

## Historical (frozen, not maintained)

Read for the reasoning at the time; do not expect paths, numbers or state to match today's tree.

- [`plans/`](plans/) and [`specs/`](specs/) — design plans and specs up to **2026-08-05**. Later plans and specs live in [`superpowers/plans/`](superpowers/plans/) and [`superpowers/specs/`](superpowers/specs/).
- [`reports/`](reports/) — dated experiment reports.
- [`archive/`](archive/) — session handoffs (`HANDOFF-*.md`, including the original 2026-07-10 rewrite handoff that used to sit at the repo root) and the 2026-09-18 pending-rulings list. Each carries an "Archived" banner.
- [`../retrospective/`](../retrospective/) — the development-process archive reconstructed from git history and session records.
