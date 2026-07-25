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
starts at login only. Enable automatic login on the build Mac, or the
runner sits dead until someone logs in.

**Builds fail at random points overnight.** The Mac slept mid-build.
`sudo pmset -a sleep 0` and keep it on mains power.

## Keychain and signing

**`errSecInternalComponent` from codesign, sometimes.** The private key
in the CI keychain needs UI approval for codesign, and there is no UI.
Fix: after match, run

```
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <password> ~/Library/Keychains/ci-db
```

The beta lane in fastlane-reference.md already does this. If you still
see the error, the lane ran against a stale keychain: delete
`~/Library/Keychains/ci-db` and rerun (the lanes recreate it).

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
`VERSIONING_SYSTEM = apple-generic` in the Xcode project. Unity 6000.3
exports set this up, older exports may not. Fix: set
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
