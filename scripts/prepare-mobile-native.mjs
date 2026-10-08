import { readFile, writeFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const mobile = path.join(root, "mobile");
const cli = path.join(mobile, "node_modules/@capacitor/cli/bin/capacitor");
const mode = process.argv[2] ?? "--all";
if (!["--ios", "--android", "--all", "--check"].includes(mode)) {
  throw new Error("Use --ios, --android, --all or --check.");
}
const exists = async (filename) => access(filename).then(() => true, () => false);
const config = await readFile(path.join(mobile, "capacitor.config.ts"), "utf8");
const version = JSON.parse(await readFile(path.join(mobile, "package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Set a numeric mobile package version before preparing native projects.");
const appId = config.match(/appId:\s*['"]([^'"]+)['"]/)?.[1];
if (!appId || !/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*){2,}$/.test(appId)) {
  throw new Error("Set a valid appId in mobile/capacitor.config.ts before preparing native projects.");
}
function runCap(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: mobile,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Capacitor ${args.join(" ")} failed.`);
}
async function replace(filename, transform) {
  const original = await readFile(filename, "utf8");
  const revised = transform(original);
  if (original !== revised) await writeFile(filename, revised, "utf8");
}

async function prepareIos(checkOnly) {
  const project = path.join(mobile, "ios/App/App.xcodeproj/project.pbxproj");
  if (!(await exists(project))) {
    if (checkOnly) throw new Error("The iOS project has not been prepared.");
    runCap(["add", "ios", "--packagemanager", "SPM"]);
  }
  const plist = path.join(mobile, "ios/App/App/Info.plist");
  const entitlements = path.join(mobile, "ios/App/App/App.entitlements");
  const settings = await readFile(project, "utf8");
  if (!settings.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${appId};`)) {
    throw new Error("The native iOS bundle identifier differs from capacitor.config.ts. Review both before building.");
  }
  if (!checkOnly) {
    await replace(plist, (source) => {
      let output = source.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]+(<\/string>)/, '$1Battery Inventory$2');
      if (!output.includes("<key>NFCReaderUsageDescription</key>")) {
        output = output.replace(/<\/dict>\s*<\/plist>/, "\t<key>NFCReaderUsageDescription</key>\n\t<string>Read battery identification tags during an explicit NFC test.</string>\n</dict>\n</plist>");
      }
      if (!output.includes("<key>ITSAppUsesNonExemptEncryption</key>")) {
        output = output.replace(/<\/dict>\s*<\/plist>/, "\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n</dict>\n</plist>");
      }
      return output;
    });
    if (!(await exists(entitlements))) {
      await writeFile(entitlements, '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>com.apple.developer.nfc.readersession.formats</key>\n\t<array><string>TAG</string></array>\n</dict>\n</plist>\n', "utf8");
    }
    await replace(project, (source) => source.replaceAll("CODE_SIGN_STYLE = Automatic;", 'CODE_SIGN_STYLE = Automatic;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;'));
    // Repeated preparation must not add the same build setting again.
    await replace(project, (source) => source.replace(/(CODE_SIGN_ENTITLEMENTS = App\/App.entitlements;\s*){2,}/g, "CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n\t\t\t\t"));
    await replace(project, (source) => source.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`));
    runCap(["sync", "ios"]);
  }
  const [info, entitlementText, projectText, packages] = await Promise.all([
    readFile(plist, "utf8"),
    readFile(entitlements, "utf8"),
    readFile(project, "utf8"),
    readFile(path.join(mobile, "ios/App/CapApp-SPM/Package.swift"), "utf8"),
  ]);
  if (!info.includes("NFCReaderUsageDescription") || !entitlementText.includes("com.apple.developer.nfc.readersession.formats") || !entitlementText.includes("<string>TAG</string>") || !projectText.includes("CODE_SIGN_ENTITLEMENTS = App/App.entitlements;") || !packages.includes("BatteryInventoryNfc") || !packages.includes("BatteryInventoryService")) {
    throw new Error("The iOS NFC purpose, entitlement, signing setting or required native plugin package is missing.");
  }
  const privacy = await readFile(path.join(mobile, "ios/App/App/PrivacyInfo.xcprivacy"), "utf8");
  if (!privacy.includes("NSPrivacyAccessedAPICategoryFileTimestamp") || !privacy.includes("C617.1") || !privacy.includes("NSPrivacyAccessedAPICategoryUserDefaults") || !privacy.includes("CA92.1") || !projectText.includes("PrivacyInfo.xcprivacy in Resources")) {
    throw new Error("The filesystem/service-configuration privacy declarations are missing from the iOS resources.");
  }
  console.log("iOS project prepared: NFC declarations and plugin binding checked. Native compilation and device reading still require macOS and a physical phone.");
}

async function prepareAndroid(checkOnly) {
  const project = path.join(mobile, "android/app/build.gradle");
  if (!(await exists(project))) {
    if (checkOnly) throw new Error("The Android project has not been prepared.");
    runCap(["add", "android"]);
  }
  const build = await readFile(project, "utf8");
  if (!build.includes(`applicationId "${appId}"`)) {
    throw new Error("The native Android application ID differs from capacitor.config.ts. Review both before building.");
  }
  if (!checkOnly) {
    await replace(project, (source) => source.replace(/versionName "[^"]+"/g, `versionName "${version}"`));
    await replace(path.join(mobile, 'android/app/src/main/res/values/strings.xml'), (source) => source.replaceAll('Battery Inventory NFC', 'Battery Inventory'));
    runCap(["sync", "android"]);
  }
  const pluginSettings = await readFile(path.join(mobile, "android/capacitor.settings.gradle"), "utf8");
  if (!pluginSettings.includes("battery-inventory-nfc") || !pluginSettings.includes("battery-inventory-service")) throw new Error("The Android NFC and secure service plugins must both be linked.");
  console.log("Android project prepared: plugin binding checked. Native compilation and device reading are separate checks.");
}

if (mode !== "--check" && (!(await exists(cli)) || !(await exists(path.join(mobile, "dist/index.html"))))) {
  throw new Error("Run npm ci and npm run build in mobile before preparing native projects.");
}
if (["--ios", "--all", "--check"].includes(mode)) await prepareIos(mode === "--check");
if (["--android", "--all", "--check"].includes(mode)) await prepareAndroid(mode === "--check");
