---
name: unity-ios-cicd
description: Use when a Unity project needs iOS builds shipped automatically. Turn a Mac into a self-hosted GitHub Actions build machine, export the Xcode project with Unity in batchmode, sign with fastlane match, and upload to TestFlight. Also use for setting up App Store Connect API keys, code signing on a headless Mac, keychain errors like errSecInternalComponent, or a runner that cannot find ruby or fastlane.
---

# Unity iOS CI/CD

This skill sets up a full pipeline: push a commit, a Mac you own builds the
game, signs it, and uploads it to TestFlight. No cloud build minutes, no
manual Xcode work. The Mac can be the user's daily machine or a spare one.

The pipeline has five phases. Each phase works on its own and ends with a
check you can run. Do them in order. Do not skip the checks.

## Requirements

- A Mac with Xcode and a Unity editor that has iOS Build Support.
- A GitHub repository for the Unity project (private is fine).
- An Apple Developer Program membership (paid, 99 USD/year). TestFlight
  does not work without it.
- Admin access to App Store Connect for the API key step.
- The build script step drives Unity from the command line. The
  **unity-headless-cli** skill helps if the project is not set up for that.

## Step 1: Interview the user

Ask these questions first. The answers decide what to set up and what to
skip. Do not start before you have all the answers.

1. **Is the Apple Developer Program membership active?** If not, stop here.
   The user must enroll at developer.apple.com first. Approval can take a
   day or two.
2. **Does the app exist in App Store Connect yet?** If not, guide the user
   to create it (name, bundle id, SKU). The bundle id must match the one
   in Unity Player Settings.
3. **Which Mac will be the build machine?** The user's own Mac works, but
   builds are heavy (10 to 40 minutes of full CPU). A spare Mac or Mac
   mini is better. The Mac must stay on and awake for builds to run.
4. **Is the repository on GitHub, and is the user an admin of it?** Admin
   is needed to add runners and secrets.
5. **What Unity version and where is it installed?** Run
   `ls /Applications/Unity/Hub/Editor/` on the build Mac. Confirm iOS
   Build Support is installed for that version.
6. **Does the project already build for iOS from the editor?** If a manual
   build fails, fix that first. CI cannot fix a broken build.
7. **Is the `gh` CLI installed and logged in?** Check with
   `gh auth status`. If yes, you can store the GitHub secrets yourself
   with `gh secret set` and the user only creates the Apple-side values.
   If no, the user pastes each secret in the browser instead.
8. **How private do they want the secret values?** Ask this straight
   out before any secret exists. Default and recommendation: values
   never enter the chat. The user saves each value to a local file (or
   pastes it in the browser) and you only run commands that read the
   file. Only if the user says they are fine pasting values into the
   chat may you accept them there, and then remind them at the end
   which values passed through and how to rotate them. Never ask the
   user to paste a secret into the chat yourself.

Warn the user before starting: this setup creates real secrets (an App
Store Connect API key, signing certificates). Each one is stored only in
GitHub encrypted secrets or in a private encrypted repo. Nothing secret
ever goes into the project repository or the chat. The full handling
rules and both storage flows are in
[references/secrets-setup.md](references/secrets-setup.md).

## Phase 1: Self-hosted runner

Install a GitHub Actions runner on the Mac and run it as a service with
labels `[self-hosted, macOS, unity]`. Then run a smoke workflow that
prints the toolchain. Full steps: [references/runner-setup.md](references/runner-setup.md).

Two facts to keep in mind the whole time:

- The runner service starts from launchd. launchd does not read
  `~/.zprofile`, so Homebrew tools are not on PATH. Every workflow adds
  them via `$GITHUB_PATH` (the reference files show how).
- Check out with `clean: false`. A clean checkout wipes `Library/` and a
  full Unity reimport can cost 30 minutes per build.

## Phase 2: Unity build script

Add a small static C# method the workflow can call with
`-executeMethod`. It builds the player to a path from the command line
and exits nonzero on failure. The exported result on iOS is an Xcode
project, not an .ipa. Signing happens later, in Fastlane.

The script and the exact Unity command line are in
[references/workflow-reference.md](references/workflow-reference.md).

**Check:** the export step runs on the runner and
`build/ios/Unity-iPhone.xcodeproj` exists.

## Phase 3: Unsigned compile check

Before any signing secrets exist, compile the exported project with
`CODE_SIGNING_ALLOWED=NO`. This proves the Unity export and the Xcode
toolchain work, and it stays useful later as a canary that needs no
secrets. The step is part of the main workflow behind a
`workflow_dispatch` input.

**Check:** the unsigned run goes green end to end.

## Phase 4: Signing

This is the phase where users get stuck, so follow the references
closely. Two parts:

1. **Collect the secrets with the user.** Walk them through creating the
   App Store Connect API key, the private certificates repo, the deploy
   key, and the two passwords. Click-by-click guide:
   [references/secrets-setup.md](references/secrets-setup.md).
2. **Run the one-time signing bootstrap.** A `setup_signing` Fastlane lane
   creates a dedicated CI keychain, then lets fastlane match generate the
   distribution certificate and provisioning profile into the encrypted
   certs repo. It runs from a manual workflow, not from a local terminal,
   so it proves the runner can sign.

Headless Mac facts that make or break this phase (details and fixes in
[references/troubleshooting.md](references/troubleshooting.md)):

- The login keychain refuses access without a GUI session. Always use a
  dedicated CI keychain.
- After importing keys, run `security set-key-partition-list`. Without it,
  codesign fails intermittently with `errSecInternalComponent`.

**Check:** the signing-setup workflow goes green and the certs repo
contains a certificate and a profile.

## Phase 5: TestFlight

The `beta` lane signs the exported project and uploads it. It also:

- pulls the next build number from TestFlight
  (`latest_testflight_build_number + 1`), so numbers never collide
- switches the Xcode project to manual signing with the match profile
- sets `ITSAppUsesNonExemptEncryption` to false so uploads do not stall
  on the export compliance question
- uploads with `skip_waiting_for_build_processing: true` plus a
  changelog, which waits only minutes instead of the full processing time

The complete Fastfile is in
[references/fastlane-reference.md](references/fastlane-reference.md).
The complete workflow, with test gate and release notes generation, is in
[references/workflow-reference.md](references/workflow-reference.md).

**Check:** the build appears in App Store Connect under TestFlight and
installs on a phone.

## When something fails

Go to [references/troubleshooting.md](references/troubleshooting.md)
first. It lists the real failures this pipeline hit and the exact fixes,
from keychain errors to PATH problems to stale `Library/` state.

## What this skill does not cover

- Android or other platforms. The runner and build-script patterns carry
  over, but signing is different.
- Remote content updates. If the project uses Addressables with remote
  content, the **unity-addressables** skill covers building and pushing
  that content, and the push step slots into this same workflow.
- App Store release. This pipeline ends at TestFlight. Promotion to the
  store is a manual decision.
