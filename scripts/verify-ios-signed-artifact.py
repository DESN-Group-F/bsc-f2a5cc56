"""Read-only verification of this project's exported iOS beta and crash symbols."""

import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile
import zipfile


class VerificationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def command(arguments):
    result = subprocess.run(arguments, capture_output=True, check=False)
    require(result.returncode == 0, "Command failed: " + arguments[0] + " " + arguments[1])
    return result.stdout, result.stderr


def one(paths, label):
    paths = list(paths)
    require(len(paths) == 1, "Expected exactly one " + label)
    return paths[0]


def plist(path):
    with path.open("rb") as stream:
        return plistlib.load(stream)


def uuid_rows(binary):
    output, _ = command(["xcrun", "dwarfdump", "--uuid", str(binary)])
    rows = re.findall(r"^UUID: ([0-9A-Fa-f-]+) \(([^)]+)\)", output.decode(), re.MULTILINE)
    require(bool(rows), "No Mach-O UUIDs returned for " + binary.name)
    return sorted({(architecture, identifier.upper()) for identifier, architecture in rows})


def executable(app, info):
    name = info.get("CFBundleExecutable")
    require(isinstance(name, str) and name and Path(name).name == name, "Invalid executable name")
    binary = app / name
    require(binary.is_file(), "Missing app executable")
    return binary


def main():
    mobile = Path.cwd()
    evidence = mobile / "build/ios/verification"
    evidence.mkdir(parents=True, exist_ok=True)
    report = {"status": "started", "recordedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        require(os.uname().sysname == "Darwin", "Apple signature verification requires macOS")
        assigned = json.loads((evidence / "build-number.json").read_text())
        require(type(assigned.get("assignedBuildNumber")) is int and assigned["assignedBuildNumber"] > 12,
                "Build number must exceed the last confirmed upload, 12")
        require(type(assigned.get("projectBuildNumber")) is int
                and assigned["assignedBuildNumber"] == assigned["projectBuildNumber"] + 1
                and assigned.get("minimumExclusive") == 12, "Build-number evidence is inconsistent")
        ipa = one((mobile / "build/ios/ipa").glob("*.ipa"), "IPA")
        archives_root = mobile / "build/ios/xcarchive"
        archives = list(archives_root.rglob("*.xcarchive"))
        if (archives_root / "Info.plist").is_file() and (archives_root / "Products").is_dir():
            archives.append(archives_root)
        archive = one(archives, "archive")
        archive_app = one((archive / "Products/Applications").glob("*.app"), "archive app")
        archive_info = plist(archive_app / "Info.plist")
        archive_binary = executable(archive_app, archive_info)
        archive_uuids = uuid_rows(archive_binary)
        dwarf = one((archive / "dSYMs").glob("*.dSYM/Contents/Resources/DWARF/" + archive_binary.name), "app dSYM binary")
        symbol_uuids = uuid_rows(dwarf)
        require(symbol_uuids == archive_uuids, "App archive and dSYM UUIDs differ")
        with tempfile.TemporaryDirectory(prefix="battery-ios-verify-") as directory:
            temporary = Path(directory)
            with zipfile.ZipFile(ipa) as bundle:
                for member in bundle.namelist():
                    member_path = Path(member)
                    require(not member_path.is_absolute() and ".." not in member_path.parts, "Unsafe IPA member")
            command(["ditto", "-x", "-k", str(ipa), str(temporary)])
            app = one((temporary / "Payload").glob("*.app"), "exported app")
            info = plist(app / "Info.plist")
            require(info.get("CFBundleIdentifier") == "com.batteryinventory.mobile", "Unexpected bundle ID")
            require(info.get("CFBundleShortVersionString") == "0.5.2", "Unexpected marketing version")
            require(str(info.get("CFBundleVersion")) == str(assigned["assignedBuildNumber"]), "Exported build number differs")
            require(archive_info.get("CFBundleIdentifier") == info["CFBundleIdentifier"], "Archive bundle ID differs")
            require(archive_info.get("CFBundleVersion") == info["CFBundleVersion"], "Archive build number differs")
            command(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)])
            raw_entitlements, _ = command(["codesign", "--display", "--entitlements", ":-", str(app)])
            entitlements = plistlib.loads(raw_entitlements)
            expected_id = "XCMXT6RZVJ.com.batteryinventory.mobile"
            require(entitlements.get("application-identifier") == expected_id, "Unexpected signed application identifier")
            require(entitlements.get("com.apple.developer.team-identifier") == "XCMXT6RZVJ", "Unexpected signed team")
            require(entitlements.get("get-task-allow", False) is False, "Debug entitlement in exported beta")
            require("TAG" in entitlements.get("com.apple.developer.nfc.readersession.formats", []), "Signed NFC TAG entitlement missing")
            profile_bytes, _ = command(["security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")])
            profile = plistlib.loads(profile_bytes)
            profile_entitlements = profile.get("Entitlements", {})
            require(profile_entitlements.get("application-identifier") == expected_id, "Profile application identifier mismatch")
            require("XCMXT6RZVJ" in profile.get("TeamIdentifier", []), "Profile team mismatch")
            require("TAG" in profile_entitlements.get("com.apple.developer.nfc.readersession.formats", []), "Profile NFC TAG entitlement missing")
            require(profile_entitlements.get("get-task-allow", False) is False, "Profile permits debugging")
            require(not profile.get("ProvisionedDevices") and not profile.get("ProvisionsAllDevices"), "Expected App Store distribution profile")
            expiry = profile.get("ExpirationDate")
            require(isinstance(expiry, datetime.datetime), "Profile expiry missing")
            expiry = expiry.replace(tzinfo=datetime.timezone.utc) if expiry.tzinfo is None else expiry
            require(expiry > datetime.datetime.now(datetime.timezone.utc), "Embedded profile expired")
            ipa_uuids = uuid_rows(executable(app, info))
            require(ipa_uuids == archive_uuids, "Exported executable and archive UUIDs differ")
            signed_keys = ["application-identifier", "com.apple.developer.team-identifier", "com.apple.developer.nfc.readersession.formats", "get-task-allow", "beta-reports-active"]
            report.update({
                "status": "passed",
                "sourceCommit": command(["git", "rev-parse", "HEAD"])[0].decode().strip(),
                "xcode": command(["xcodebuild", "-version"])[0].decode().strip(),
                "iphoneosSDK": command(["xcrun", "--sdk", "iphoneos", "--show-sdk-version"])[0].decode().strip(),
                "ipa": {"name": ipa.name, "sha256": hashlib.sha256(ipa.read_bytes()).hexdigest(), "bytes": ipa.stat().st_size},
                "app": {"bundleID": info["CFBundleIdentifier"], "version": info["CFBundleShortVersionString"], "build": info["CFBundleVersion"]},
                "codesign": {"verification": "passed", "deep": True, "strict": True, "entitlements": {key: entitlements[key] for key in signed_keys if key in entitlements}},
                "profile": {"entitlementCompatibility": "passed", "distribution": "app_store", "expiry": expiry.isoformat(), "rawProfileExported": False, "independentAppleTrustChainVerification": False},
                "uuidMatches": {"exportedExecutable": ipa_uuids, "archiveExecutable": archive_uuids, "appDSYM": symbol_uuids, "dsymPath": str(dwarf.relative_to(mobile))},
                "limits": ["No installation or physical NFC/haptic result is established", "App Store Connect processing and internal-group assignment remain separate"],
            })
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error) if isinstance(error, VerificationError) else type(error).__name__
        raise
    finally:
        (evidence / "signed-artifact.json").write_text(json.dumps(report, indent=2) + "\n")
    print("Signed artifact checks passed; limited evidence saved to build/ios/verification/signed-artifact.json")


if __name__ == "__main__":
    main()
