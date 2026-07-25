---
name: unity-ios-cicd
description: Use when a Unity project needs iOS builds shipped automatically. Turn a Mac into a self-hosted GitHub Actions build machine, export the Xcode project with Unity in batchmode, sign with fastlane match, and upload to TestFlight. Also use for setting up App Store Connect API keys, code signing on a headless Mac, keychain errors like errSecInternalComponent, or a runner that cannot find ruby or fastlane.
---

# Unity iOS CI/CD

This skill sets up a full pipeline: trigger a workflow, a Mac you own
builds the game, signs it, and uploads it to TestFlight. No cloud build
minutes, no manual Xcode work. The Mac can be the user's daily machine or
a spare one. The default trigger is a button in the Actions tab; a tag or
push trigger is a one-line addition once the pipeline is trusted.

The pipeline has five phases. Each phase works on its own and ends with a
check you can run. Do them in order. Do not skip the checks.

Set expectations with the user before starting: a first-time setup is
about half a day end to end, and the secrets phase alone can take an
hour. A dedicated build Mac stays on and awake around the clock; a
daily machine can instead run in daily-machine mode (builds only while
logged in, see runner-setup).

## Requirements

- A Mac with Xcode and a Unity editor that has iOS Build Support. The
  verified setup is Apple Silicon; on Intel, Homebrew lives in
  `/usr/local` instead of `/opt/homebrew`, adjust the PATH lines.
- A GitHub repository for the Unity project (private is fine).
- An Apple Developer Program membership (paid, 99 USD/year). TestFlight
  does not work without it.
- Admin access to App Store Connect for the API key step.
- This skill is self-contained: the build script and workflows it ships
  need no other skill. The **unity-headless-cli** skill is useful on top
  if you also want to drive the editor interactively from the terminal.

## Step 0: Fresh machine checklist

On a Mac that never built this project before, check these in order.
Each one is a hard stop that fails with a confusing error later if
skipped. Run the commands over SSH or in a terminal on the build Mac.

1. **Homebrew installed?** `command -v brew`. If missing, install it
   from brew.sh first (needs an admin user, one sudo prompt).
2. **Enough disk?** `df -h /`. Xcode, Unity, `Library/`, DerivedData
   and checkouts together want 100 GB free or more. Clear space now,
   not at a dead build in a month.
3. **Xcode installed and ready?** Xcode itself is not a given on a
   fresh Mac: it is a 40+ GB install from the App Store (GUI) or as a
   .xip from developer.apple.com/download (works over SSH with `scp` +
   `xip --expand`). Budget hours for the download. Then run
   `sudo xcodebuild -license accept`, then `xcodebuild -runFirstLaunch`.
   On Xcode 15 and newer the iOS platform is another multi-GB download:
   `xcodebuild -downloadPlatform iOS`. Verify with
   `xcodebuild -version`.
4. **Unity licensed on this machine?** Batchmode needs an activated
   license and fails with "No valid Unity license" without one.
   Signing into Unity Hub needs a GUI once. Sitting at the Mac: just
   open Hub and sign in. Headless Mac: you need one remote GUI
   session. In order of reliability:

   - Enable the Screen Sharing service over SSH:
     `sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.screensharing.plist`
     and connect from another Mac (Finder, Cmd+K,
     `vnc://<mac-name>.local`, log in with the Mac account). This
     opens port 5900: only do it on a trusted home or office network
     (or over a VPN), never on a Mac reachable from the internet, and
     turn it off after (teardown).
   - From Windows or Linux, try any VNC client against that service.
     Honest warning: recent macOS restricts the legacy VNC mode
     third-party clients need (the old `kickstart -setvnclegacy` route
     is unreliable, caps passwords at 8 characters, and puts them in
     shell history), and a session can come up view-only. If typing
     does not work, use the next line.
   - The fallback that always works: attach a display and keyboard to
     the Mac once.

   These remote-desktop steps are the one part of this skill not
   verified end to end on the reference machine; treat them as a map,
   not a guarantee, and turn Screen Sharing off again when done
   (teardown section in
   [references/runner-setup.md](references/runner-setup.md)).
   Use the one GUI session for everything GUI in this checklist (Hub
   sign-in, automatic login in Phase 1). Sign in to Hub (Personal), or
   activate with the licensing client or `-serial` (Pro). Verify by
   running any `-batchmode -quit` command and checking the log.
5. **Git identity set?** `git config user.name` must print something.
   The signing bootstrap pushes to the certs repo and dies with
   "Please tell me who you are" without it:
   `git config --global user.name "CI" && git config --global user.email ci@example.com`.
6. **Project opens on this machine?** Open the project once (or run a
   batchmode import) so `Library/` builds and packages resolve.

## Step 1: Interview the user

Ask these questions first. The answers decide what to set up and what to
skip. Do not start before you have all the answers.

1. **Is the Apple Developer Program membership active?** If not, stop here.
   The user must enroll at developer.apple.com first. Approval can take a
   day or two.
2. **Does the app exist in App Store Connect yet?** If not, walk the
   user through creating it, click by click (see the app record section
   in [references/secrets-setup.md](references/secrets-setup.md)). Then
   verify the bundle id yourself: read it from
   `ProjectSettings/ProjectSettings.asset`
   (`applicationIdentifier` block) and compare it to the one in App
   Store Connect. A mismatch here surfaces hours later as a signing
   error nobody connects back to this step.
3. **What is the Apple Team ID?** developer.apple.com -> Membership.
   A 10-character code. It goes into the Fastfile as `TEAM_ID`.
4. **Which Mac will be the build machine?** The user's own Mac works, but
   builds are heavy (10 to 40 minutes of full CPU). A spare Mac or Mac
   mini is better. A dedicated Mac stays on and awake; a daily machine
   uses daily-machine mode (runner-setup) and builds only while the
   user is logged in.
5. **Is the repository on GitHub, and is the user an admin of it?** Admin
   is needed to add runners and secrets.
6. **What Unity version and where is it installed?** Run
   `ls /Applications/Unity/Hub/Editor/` on the build Mac. Confirm iOS
   Build Support is installed for that version.
7. **Does the project already build for iOS from the editor?** If a manual
   build fails, fix that first. CI cannot fix a broken build.
   While checking, also look for CocoaPods users: Firebase, ad or
   analytics SDKs, or an `ExternalDependencyManager` folder in Assets.
   If present, the pipeline needs two small changes; follow the
   CocoaPods section below.
   Also check whether the project has any EditMode tests. If not,
   remove the test gate step from the workflow instead of shipping a
   gate that always passes.
8. **Is the `gh` CLI installed and logged in?** (`gh` is GitHub's
   command-line tool.) Check with `gh auth status`. If yes, you can
   store the GitHub secrets yourself with `gh secret set` and the user
   only creates the Apple-side values. A fine-grained token without
   repo access makes those commands fail confusingly, so check the
   scopes in the same output. If no, the user pastes each secret in
   the browser instead.
9. **Does the project ship remote content?** Check, do not just ask:
   look for Addressables in `Packages/manifest.json` and remote load
   paths in the Addressables settings. If the project loads content
   from a CDN or bucket, the build must also build and upload that
   content, or the new binary can point at a catalog that does not
   exist yet. See the remote content section below.
10. **How private do they want the secret values?** Ask this straight
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
closely. Three parts:

1. **Collect the secrets with the user.** Walk them through creating the
   App Store Connect API key, the private certificates repo, the deploy
   key, and the two passwords. Click-by-click guide:
   [references/secrets-setup.md](references/secrets-setup.md).
2. **Pre-check the certificate limit.** Apple allows two active
   distribution certificates per team. Before the bootstrap, have the
   user count theirs at developer.apple.com -> Certificates. At the
   limit already? See the `setup_signing` entry in troubleshooting
   (import the existing cert instead of generating).
3. **Run the one-time signing bootstrap.** A `setup_signing` Fastlane lane
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
  on the export compliance question. **Ask the user first**: this is a
  legal declaration, and false is only correct when the app uses
  nothing beyond standard HTTPS. If the app ships its own encryption,
  remove that line and answer the compliance question honestly in App
  Store Connect instead.
- uploads with `skip_waiting_for_build_processing: true` plus a
  changelog: it waits only until the build appears on App Store Connect
  (minutes), not for full processing

The complete Fastfile is in
[references/fastlane-reference.md](references/fastlane-reference.md).
The complete workflow, with test gate and release notes generation, is in
[references/workflow-reference.md](references/workflow-reference.md).

**Check:** the build appears in App Store Connect under TestFlight and
installs on a phone. For that last part the user needs the TestFlight
app on their phone and themselves added as an internal tester
(App Store Connect -> TestFlight -> Internal Testing, add a group with
their Apple ID). Guide them there on the first build.

## CocoaPods projects (only if the interview found EDM4U)

Firebase, AdMob, and most ad or analytics SDKs ship with EDM4U (the
External Dependency Manager for Unity). On iOS they declare native
libraries as CocoaPods. Verified on a real editor (see test-cases.md):
the pipeline needs exactly two changes.

1. **CocoaPods on the build Mac**: `brew install cocoapods`. That is
   the whole setup. With `pod` on PATH, EDM4U runs `pod install`
   itself during the Unity export, even in batchmode: the export
   folder comes out with `Podfile`, `Pods/`, and
   `Unity-iPhone.xcworkspace` already in place. (The workflow's
   `$GITHUB_PATH` step already puts Homebrew on PATH.)
2. **Build the workspace, not the project.** Pods live in the
   workspace. Both the shipped Fastfile and the unsigned check
   auto-detect `Unity-iPhone.xcworkspace` and use it when present, so
   no edit is needed. Building the `.xcodeproj` directly is the
   classic mistake: it compiles without the pods and fails with
   missing-framework or linker errors.

If the export finishes without `Pods/`, EDM4U could not find `pod`
(or its auto-install setting is off: Assets -> External Dependency
Manager -> iOS Resolver -> Settings). Fallback step, between export
and signing:

```yaml
      - name: Pod install (only if EDM4U did not run it)
        run: cd build/ios && pod install
```

## Remote content (only if the interview found it)

If the project uses Addressables with remote content, two extra pieces
go into the same TestFlight workflow:

1. **Build content with the player.** The build method calls
   `AddressableAssetSettings.BuildPlayerContent` before `BuildPlayer`,
   and fails the build if the content build reports an error. The
   **unity-addressables** skill has the exact call and settings.
2. **Upload content before the TestFlight upload.** The upload order is
   not optional: **bundles first, catalog last**. A catalog that goes
   up first can reference bundles that are not there yet, and every
   fresh install in that window breaks. And the catalog must be served
   with `Cache-Control: no-store`: with a pinned Player Version
   Override (the usual setup for updatable catalogs, see the
   unity-addressables skill) the catalog keeps the same filename while
   its content changes, so an edge cache will happily serve a stale
   one. Bundles are content-hashed and can cache forever.

The generic upload step (any S3-compatible host) is in
[references/workflow-reference.md](references/workflow-reference.md),
with the host credentials handled like every other secret in
[references/secrets-setup.md](references/secrets-setup.md).

## When something fails

Go to [references/troubleshooting.md](references/troubleshooting.md)
first. It lists the real failures this pipeline hit and the exact fixes,
from keychain errors to PATH problems to stale `Library/` state.

## What this skill does not cover

- Android or other platforms. The runner and build-script patterns carry
  over, but signing is different.
- Deep Addressables work (groups, loading, hosting choices). The remote
  content section above covers only what the build pipeline needs; the
  **unity-addressables** skill covers the rest.
- App Store release. This pipeline ends at TestFlight. Promotion to the
  store is a manual decision.
- Intel Macs and GitHub-hosted macOS runners. Hosted runners start cold
  every run, so the warm `Library/` advantage (the biggest time saver in
  this pipeline) is lost there.
