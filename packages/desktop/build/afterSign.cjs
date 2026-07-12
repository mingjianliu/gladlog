// After electron-builder signs the app on macOS without a real certificate, it
// can leave an inconsistent signature that Gatekeeper reports as "gladlog is
// damaged". Force a clean ad-hoc signature here so a downloaded build opens
// after just `xattr -cr` (no notarization ⇒ still "unidentified developer" on
// first open, but not the scary "damaged"). No-op on Windows/Linux.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], {
    stdio: "inherit",
  });
};
