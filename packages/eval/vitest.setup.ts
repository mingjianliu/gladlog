// Since the large data tables (spellNames/talentIdMap) moved to background
// loading (analysis's data/ensure.ts), an import no longer guarantees they are
// ready — assertions about names or talents would go red at random depending on
// load timing. Wait for them once, here, for everyone.
import { ensureAnalysisData } from "@gladlog/analysis";

import { installFlagGuard } from "../analysis/test/support/flagGuard";

await ensureAnalysisData();
// Same flag-singleton guard as analysis (see packages/analysis/vitest.setup.ts).
installFlagGuard();
