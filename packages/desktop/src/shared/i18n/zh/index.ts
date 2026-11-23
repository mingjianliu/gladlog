import { zhBatch } from "./batch";
import { zhCommon } from "./common";
import { zhDev } from "./dev";
import { zhMatchList } from "./matchList";
import { zhNav } from "./nav";
import { zhRecorder } from "./recorder";
import { zhReportAi } from "./reportAi";
import { zhReportCards } from "./reportCards";
import { zhReportDerive } from "./reportDerive";
import { zhReportReplay } from "./reportReplay";
import { zhSettings } from "./settings";
import { zhStats } from "./stats";
import { zhUpdate } from "./update";

// The zh dictionary is the baseline: its keys define `MessageKey`.
// Each namespace lives in its own file and is merged here.
export const zhMessages = {
  ...zhCommon,
  ...zhSettings,
  ...zhNav,
  ...zhMatchList,
  ...zhBatch,
  ...zhUpdate,
  ...zhRecorder,
  ...zhDev,
  ...zhStats,
  ...zhReportDerive,
  ...zhReportCards,
  ...zhReportReplay,
  ...zhReportAi,
};
