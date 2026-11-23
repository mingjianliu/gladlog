import { zhCommon } from "./common";
import { zhRecorder } from "./recorder";
import { zhSettings } from "./settings";
import { zhUpdate } from "./update";

// The zh dictionary is the baseline: its keys define `MessageKey`.
// Each namespace lives in its own file and is merged here.
export const zhMessages = {
  ...zhCommon,
  ...zhSettings,
  ...zhUpdate,
  ...zhRecorder,
};
