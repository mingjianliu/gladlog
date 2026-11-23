import type { MessageKey, Messages } from "../index";
import { enCommon } from "./common";
import { enRecorder } from "./recorder";
import { enSettings } from "./settings";
import { enUpdate } from "./update";

// `satisfies Messages` fails typecheck on a missing key (or a wrongly typed value).
export const enMessages = {
  ...enCommon,
  ...enSettings,
  ...enUpdate,
  ...enRecorder,
} satisfies Messages;

// Excess-property checks do not apply to spread members, so `satisfies` alone
// lets an extra key through. This constraint fails typecheck with the extra
// key's name if en defines a key zh does not.
type MustBeNever<T extends never> = T;
export type EnExtraKeys = MustBeNever<
  Exclude<keyof typeof enMessages, MessageKey>
>;
