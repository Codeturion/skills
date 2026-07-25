# Verification record

Everything in this skill comes from a live pipeline, not from docs. The
reference setup is a production Unity project shipping to TestFlight
from a headless Mac mini (M2 Pro, Apple Silicon) with a self-hosted
GitHub Actions runner.

## Environment

- macOS on Apple Silicon (arm64), no GUI session (headless, SSH only)
- Unity 6000.3 with iOS Build Support
- Xcode 16.x, Homebrew ruby, fastlane via Bundler
- Runner installed per repo in `~/actions-runner-<repo>/`, running as a
  LaunchAgent via `./svc.sh install`; three runners share the machine

## Verified end to end (checked 2026-07-25)

- **TestFlight pipeline green**: the last five runs of the testflight
  workflow on the reference project all completed with conclusion
  `success` (most recent: 2026-07-24). Builds appear in App Store
  Connect and install on real devices.
- **Runner as LaunchAgent**: `launchctl list` shows the runner services
  alive with exit code 0. Runners survive reboots via automatic login.
- **Signing bootstrap re-runnable**: `setup_signing` was run more than
  once on the reference setup (initial setup, then again during
  debugging) with no manual cleanup between runs.
- **Fresh-keychain pattern**: both lanes delete and recreate the CI
  keychain on every run; many runs over weeks, no keychain-state
  carryover failures since the pattern was adopted. The reference
  setup predates the per-app naming rule in fastlane-reference.md (it
  used a single shared name and only one of its runners signs iOS);
  the rule exists exactly because a second signing repo on the same
  Mac would race that shared name.

## CocoaPods path (verified 2026-07-25)

Tested on a fresh minimal project, same machine, Unity 6000.3.10f1,
EDM4U 1.2.188 (OpenUPM), CocoaPods 1.16.2, declaring the
FirebaseAnalytics pod via a `Dependencies.xml`:

- Batchmode iOS export: EDM4U ran `pod install` itself during the
  export. The export folder contained `Podfile`, `Podfile.lock`,
  `Pods/` (FirebaseAnalytics plus five Google dependency pods), and
  `Unity-iPhone.xcworkspace`, with no manual step.
- Unsigned Release compile of the workspace
  (`xcodebuild -workspace ... CODE_SIGNING_ALLOWED=NO`): BUILD
  SUCCEEDED, Firebase linked.
- Also reproduced along the way: a project with no saved scene fails
  batchmode builds with `Cannot build untitled scene` (now in
  troubleshooting).

Not verified on the pods path: a signed TestFlight upload of a pods
project (the signing steps are identical to the plain path, only the
`build_app` target changes from project to workspace).

## Facts that were learned by failing

Each of these caused a real red build before the fix shipped into the
reference files:

1. **launchd skips `~/.zprofile`**: first runs died with
   `bundle: command not found`. Fix: `$GITHUB_PATH` step in every
   workflow (runner-setup.md section 4).
2. **Login keychain refuses headless access**: match into the login
   keychain worked over screen sharing and failed over SSH/launchd.
   Fix: dedicated `ci` keychain (fastlane-reference.md).
3. **`errSecInternalComponent` intermittent**: codesign failed on some
   runs only. Fix: `security set-key-partition-list` after match.
4. **Cold `Library/` cost**: a clean checkout triggered a full reimport,
   about 30 minutes on the reference project. Fix: `clean: false` on
   checkout.
5. **`pilot` hour-long waits**: uploads blocked the runner until Apple
   finished processing. Fix: `skip_waiting_for_build_processing: true`
   with a changelog; wait dropped to minutes.
6. **Missing Compliance stall**: builds uploaded but testers saw
   nothing until the export question was answered in the browser. Fix:
   `ITSAppUsesNonExemptEncryption=false` in the lane.

## Not covered by this record

- Intel Macs (the reference machine is arm64; paths and Homebrew prefix
  differ on Intel: `/usr/local` instead of `/opt/homebrew`).
- GitHub-hosted macOS runners (different PATH, ephemeral keychains, and
  billing; this skill is about self-hosted).
- App Store release submission (pipeline ends at TestFlight).
