import type { MessageKey, Messages } from "../index";
import { enBatch } from "./batch";
import { enCommon } from "./common";
import { enDev } from "./dev";
import { enDialogs } from "./dialogs";
import { enErrors } from "./errors";
import { enMatchList } from "./matchList";
import { enNav } from "./nav";
import { enRadar } from "./radar";
import { enRecorder } from "./recorder";
import { enReportAi } from "./reportAi";
import { enReportCards } from "./reportCards";
import { enReportDerive } from "./reportDerive";
import { enReportReplay } from "./reportReplay";
import { enSettings } from "./settings";
import { enStats } from "./stats";
import { enUpdate } from "./update";

// `satisfies Messages` fails typecheck on a missing key (or a wrongly typed value).
export const enMessages = {
  ...enCommon,
  ...enSettings,
  ...enNav,
  ...enMatchList,
  ...enBatch,
  ...enUpdate,
  ...enRecorder,
  ...enDev,
  ...enStats,
  ...enRadar,
  ...enErrors,
  ...enDialogs,
  ...enReportDerive,
  ...enReportCards,
  ...enReportReplay,
  ...enReportAi,
} satisfies Messages;

// Excess-property checks do not apply to spread members, so `satisfies` alone
// lets an extra key through. This constraint fails typecheck with the extra
// key's name if en defines a key zh does not.
type MustBeNever<T extends never> = T;
export type EnExtraKeys = MustBeNever<
  Exclude<keyof typeof enMessages, MessageKey>
>;
