import { zhBatch } from "./batch";
import { zhCommon } from "./common";
import { zhDev } from "./dev";
import { zhMatchList } from "./matchList";
import { zhNav } from "./nav";
import { zhRecorder } from "./recorder";
import { zhReportDerive } from "./reportDerive";
import { zhSettings } from "./settings";
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
  ...zhReportDerive,
};
