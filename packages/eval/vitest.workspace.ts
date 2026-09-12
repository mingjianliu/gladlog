// Hybrid isolation for local runs (shared module cache for allowlisted files);
// CI and GLADLOG_TEST_ISOLATE=all run everything isolated. See
// packages/analysis/test/support/testIsolation.ts.
import { fileURLToPath } from "node:url";

import { defineWorkspace } from "vitest/config";

import { vitestProjects } from "../analysis/test/support/testIsolation";

export default defineWorkspace(
  vitestProjects(fileURLToPath(new URL(".", import.meta.url)), "eval") as never,
);
