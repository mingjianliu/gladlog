import { zhCommon } from "./common";
import { zhSettings } from "./settings";

// The zh dictionary is the baseline: its keys define `MessageKey`.
// Each namespace lives in its own file and is merged here.
export const zhMessages = {
  ...zhCommon,
  ...zhSettings,
};
