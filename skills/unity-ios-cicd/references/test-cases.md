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
- **Fresh-keychain pattern**: both lanes delete and recreate the `ci`
  keychain on every run; hundreds of runs, no keychain-state carryover
  failures since the pattern was adopted.

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
