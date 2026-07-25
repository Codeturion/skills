# Troubleshooting

Real failures this pipeline hit, with the fixes that worked. Check here
before searching the web: most of these have misleading error text.

## Runner and PATH

**Job stays queued forever.** The `runs-on` labels do not match the
runner. Compare the workflow's `runs-on` list with the runner's labels
in repo Settings -> Actions -> Runners. All labels must match.

**`bundle: command not found` or `ruby` is the ancient system one.**
launchd started the runner, and launchd does not read `~/.zprofile`, so
Homebrew is not on PATH. Add the PATH step from runner-setup.md as the
first step after checkout. Do not fix it by editing the runner plist, the
fix disappears on runner reinstall.

**Runner offline after reboot.** The service is a LaunchAgent, so it
starts at login only. On a dedicated build Mac, enable automatic login
(and mind FileVault, see runner-setup.md). On a daily machine this is
expected behavior: the runner comes back when the user logs in.

**Builds fail at random points overnight.** The Mac slept mid-build.
On a dedicated build Mac: `sudo pmset -a sleep 0` and mains power. On
a daily machine in daily-machine mode: expected, trigger builds while
the machine is awake instead.

## Keychain and signing

**`errSecInternalComponent` from codesign, sometimes.** The private key
in the CI keychain needs UI approval for codesign, and there is no UI.
Fix: after match, run

```
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <password> ~/Library/Keychains/<keychain-name>-db
```

The beta lane in fastlane-reference.md already does this. If you still
see the error, the lane ran against a stale keychain: delete the
keychain db file and rerun (the lanes recreate it).

**codesign complains about an ambiguous identity.** Several old CI
keychains sit in the search list, each holding the same team's "Apple
Distribution" identity. List them with `security list-keychains` and
delete stale ones (`security delete-keychain <name>`); the lanes
recreate the current one.

**Keychain vanishes mid-build, or partition-list-style failures on a
Mac with several runners.** Two repos share one keychain name. The
lanes delete and recreate their keychain on every run, so builds from
two repos running at once destroy each other's keychain. Give every
repo its own `KEYCHAIN_NAME` (fastlane-reference.md).

**`setup_signing` fails creating the certificate.** Apple allows only
two active distribution certificates per team. Anyone who shipped
before may already be at the limit. List them at developer.apple.com ->
Certificates. Either revoke an unused one (careful: revoking breaks
whatever pipeline still signs with it) or import the existing cert into
match with `fastlane match import` instead of generating a new one.

**match asks for a password interactively and the job hangs.**
`MATCH_PASSWORD` is not set or not exported into the step's `env`.
Every secret the Fastfile reads must appear in the step's `env` block.

**match cannot clone the certs repo.** The deploy key step did not run,
or the key has no write access (needed on the very first
`setup_signing` run). Also confirm `MATCH_GIT_URL` is the SSH form,
`git@github.com:...`, not `https://...`.

**Signing works locally but not in CI.** Local Xcode uses the login
keychain and its cached certs. CI must not: the login keychain refuses
access without a GUI session. Use the dedicated CI keychain path from
the Fastfile, never `security default-keychain` tricks.

**Certs revoked or expired.** Rerun the Signing setup workflow. It is
re-runnable: match sees the invalid cert and issues a fresh one into the
certs repo.

## Unity export

**`executeMethod class not found`.** The CIBuild class is not compiling,
usually a compile error somewhere in the project. Run the EditMode test
step alone, or check the streamed Unity log above the failure.

**Export succeeds but `Unity-iPhone.xcodeproj` is missing.** Unity built
to the wrong path. The `-buildPath` argument must be absolute
(`$PWD/build/ios`), Unity resolves relative paths against its own
working directory.

**First build takes forever.** Cold `Library/`, full reimport. Expected
once. If it happens every time, something wipes the checkout: make sure
`clean: false` is set and nothing runs `git clean` on the runner.

**Unity exits 0 but the log shows errors.** Always pass `-logFile -` and
make the build method call `EditorApplication.Exit(1)` on failure, like
the script in workflow-reference.md. Without the explicit exit, batchmode
can end green after a failed build.

**Test step fails on a project with no tests.** The gate assumes tests
exist. If the project has none, remove the EditMode step (and the
artifact upload) from the workflow until it does; a gate that always
passes on zero tests protects nothing.

**Runner disk fills up over time.** Three growers: the .ipa in
`build/output`, an .xcarchive per run in
`~/Library/Developer/Xcode/Archives` (the biggest one on a Mac that
ships daily), and DerivedData. The workflow's cleanup step handles
`build/output` and saves the dSYM as an artifact first. Archives and
DerivedData are manual: on a CI-only Mac, delete old archive folders
when the disk gets tight (the dSYM artifacts make them safe to drop);
on a daily machine never blanket-delete `Archives`, your other apps'
archives live there too. If
builds start failing oddly after months of stale workspace state, the
reset is: delete the repo folder inside the runner's `_work` directory
and let checkout rebuild it (costs one full reimport).

## CocoaPods (EDM4U projects)

**Linker or missing-framework errors on a Firebase/ads project.** The
build used the `.xcodeproj` instead of the `.xcworkspace`. Pods only
link through the workspace. Point `build_app` (or `xcodebuild`) at
`Unity-iPhone.xcworkspace` with the `Unity-iPhone` scheme.

**Export finished but there is no `Pods/` folder.** EDM4U could not
find `pod` during the export (check the Unity log for its error), or
its Cocoapods integration setting is off. Fix: `brew install
cocoapods` on the runner, make sure the Homebrew PATH step runs before
the export, or run `pod install` in the export folder as its own step.

**Deployment-target warnings from pod targets.** Pods pinned to old
iOS versions (9.0) warn under new Xcode. Warnings only; safe to
ignore until a pod actually refuses to build.

**`Cannot build untitled scene` from a batchmode build.** The project
has no scene in Build Settings and no saved scene asset. Add a scene
to `EditorBuildSettings.scenes`, or create and save one in the build
script before `BuildPlayer`.

## TestFlight

**Upload succeeds but the build never shows for testers, "Missing
Compliance".** The export compliance question was not answered. The beta
lane sets `ITSAppUsesNonExemptEncryption` to false in the Info.plist,
which answers it for apps that only use standard HTTPS. If the app uses
custom crypto, answer honestly in App Store Connect instead.

**`pilot` waits for an hour.** `skip_waiting_for_build_processing` is
missing, so it waits for full processing. With it set (plus a changelog,
which pilot needs to still set the notes), it returns in minutes.

**Build number already used.** Two builds raced, or someone uploaded
manually in between. The lane pulls
`latest_testflight_build_number + 1` at run time, so just rerun. Keep
the `concurrency` group in the workflow so CI cannot race itself.

**Everything worked for months, now every Apple call returns 403 or an
"agreement" error.** Apple updated the Program License Agreement and it
sits unaccepted. Only the Account Holder can fix it: log into App Store
Connect in a browser and accept the banner. Nothing in the pipeline is
broken; this is the most common "CI broke overnight and nobody changed
anything" cause.

**CI is green but the build never appears for testers, and no
"Missing Compliance" either.** With `skip_waiting_for_build_processing`
the upload returns before Apple finishes processing. If processing then
rejects the binary (icon, asset or entitlement problems, the ITMS
errors), the only notice is an email from Apple to the account holder.
Check App Store Connect -> TestFlight for the build's real state and
the mail for the ITMS code.

**Signing suddenly fails after adding Push, Game Center, IAP or Sign in
with Apple.** New capabilities invalidate the provisioning profile, and
the beta lane runs match read-only, so it keeps using the dead profile.
Fix: enable the capability on the App ID (developer.apple.com ->
Identifiers), then re-run the Signing setup workflow to regenerate the
profile.

**API key auth fails with a JWT or key error.** The `ASC_KEY_CONTENT`
secret was mangled: pasted with literal `\n` instead of real line
breaks, or an editor stripped the final newline. Re-set it straight
from the file (`gh secret set ASC_KEY_CONTENT < AuthKey_XXXX.p8`), do
not retype it.

**API key works for some calls, fails others.** The key's role is too
low. App Manager covers everything this pipeline does on the reference
setup. Developer role does not. If `setup_signing` still gets a 403 on
certificate creation with App Manager, recreate the key with Admin,
that call is the pickiest one in the whole flow.

**match clones the certs repo but errors about a missing branch.** A
certs repo created with a README starts on `main`, while match may look
for another branch. Create the certs repo empty (no README), or pass
the branch explicitly with `git_branch` in the `match` call.

**`increment_build_number` fails with "Apple Generic Versioning is not
enabled".** The action drives `agvtool`, which needs
`VERSIONING_SYSTEM = apple-generic` in the Xcode project. The verified
Unity 6000.3 export had it enabled; other Unity versions may not. Fix: set
`CURRENT_PROJECT_VERSION` and `VERSIONING_SYSTEM` on the target, or
write the build number with `update_info_plist` instead.

**Auto release notes show only one commit.** The checkout was shallow.
Set `fetch-depth: 0` on the checkout step, `git log` needs history.

**Unity batchmode dies with "No valid Unity license".** The build Mac
was never activated. Open Unity Hub once on that Mac and sign in, or
activate Pro with the licensing client. See the fresh machine checklist
in SKILL.md.

**xcodebuild errors about the license or a missing iOS platform.**
First run state. `sudo xcodebuild -license accept`, then
`xcodebuild -runFirstLaunch`, then `xcodebuild -downloadPlatform iOS`
(Xcode 15 and newer).
