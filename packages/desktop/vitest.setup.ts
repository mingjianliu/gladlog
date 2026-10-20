// Since the large data tables (spellNames/talentIdMap) moved to background
// loading (analysis' data/ensure.ts), an import no longer guarantees they are
// ready — name/talent assertions would go red at random depending on load
// timing. Wait for them once, here, for everyone.
import { ensureAnalysisData } from "@gladlog/analysis";
import { configure } from "@testing-library/react";

// GH #26 flaky ledger. This 5 s wait was the 2026-08-28 "slow runner" theory
// and it was wrong: the flakes reproduced at 5019 ms too. Root cause found
// 2026-09-02 and pinned deterministically (test/devpanel.jsonTree.race.test.tsx,
// the two "GH #26 根因" cases in StructuredAnalysisPanel.test.tsx): a passive
// effect that RESETS state (JsonTree's mount-time expansion reset; the
// analysis panel's cache-query effect re-running on the initial `lang` flip)
// was still pending when the test's interaction landed, and React flushes
// pending passive effects before rendering the interaction's update — so the
// reset was ordered after the click / onDone and silently undid it. The
// window is opened by testing-library's own `waitFor`: it observes the DOM via
// MutationObserver (microtask) and drains with `setTimeout(0)`, while React's
// passive flush rides `setImmediate`; under load the timer wins. Both resets
// are gone from the components. The longer wait is kept only because no
// assertion here depends on something *not* happening within 1 s, so it costs
// nothing; it is no longer load-bearing.
configure({ asyncUtilTimeout: 5000 });

await ensureAnalysisData();
