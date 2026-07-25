# Workflow reference

Three workflows in `.github/workflows/`, plus the Unity build script they
call. Replace the Unity version in the `UNITY` env with the project's
version (check with `ls /Applications/Unity/Hub/Editor/` on the runner).

## Unity build script (Phase 2)

`Assets/Editor/CIBuild.cs`. Any editor folder works. It reads the output
path from the command line and exits nonzero on failure, so a broken
export fails the workflow step instead of hanging.

```csharp
using System;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

public static class CIBuild
{
    public static void BuildIOS()
    {
        var buildPath = GetArg("-buildPath");
        if (string.IsNullOrEmpty(buildPath))
        {
            // No relative fallback: Unity resolves relative paths against its
            // own working directory, not the project. Require the absolute arg.
            Debug.LogError("Missing -buildPath argument (must be absolute)");
            EditorApplication.Exit(1);
            return;
        }

        var options = new BuildPlayerOptions
        {
            scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray(),
            locationPathName = buildPath,
            target = BuildTarget.iOS,
            options = BuildOptions.None
        };

        var report = BuildPipeline.BuildPlayer(options);
        if (report.summary.result != BuildResult.Succeeded)
        {
            Debug.LogError($"iOS export failed: result={report.summary.result} errors={report.summary.totalErrors}");
            EditorApplication.Exit(1);
        }
    }

    private static string GetArg(string name)
    {
        var args = Environment.GetCommandLineArgs();
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == name)
                return args[i + 1];
        }

        return null;
    }
}
```

If the project uses Addressables, build content before the player inside
the same method (the **unity-addressables** skill covers the call):

```csharp
AddressableAssetSettings.BuildPlayerContent(out AddressablesPlayerBuildResult addressablesResult);
if (!string.IsNullOrEmpty(addressablesResult.Error))
{
    Debug.LogError($"Addressables build failed: {addressablesResult.Error}");
    EditorApplication.Exit(1);
    return;
}
```

(Usings: `UnityEditor.AddressableAssets.Build` and
`UnityEditor.AddressableAssets.Settings`.)

## Remote content upload step (only for remote Addressables)

Goes into testflight.yml between the export and the signing step, so a
failed content upload never ships a binary pointing at missing content.
Works with any S3-compatible host (S3, R2, GCS interop, MinIO) via
rclone (`brew install rclone` on the runner). Secrets:
`CONTENT_ACCESS_KEY_ID`, `CONTENT_SECRET_ACCESS_KEY`, and the endpoint.

```yaml
      - name: Push remote content (bundles first, catalog last)
        if: ${{ !inputs.unsigned_check }}
        env:
          RCLONE_CONFIG_CDN_TYPE: s3
          RCLONE_CONFIG_CDN_ACCESS_KEY_ID: ${{ secrets.CONTENT_ACCESS_KEY_ID }}
          RCLONE_CONFIG_CDN_SECRET_ACCESS_KEY: ${{ secrets.CONTENT_SECRET_ACCESS_KEY }}
          RCLONE_CONFIG_CDN_ENDPOINT: https://YOUR-S3-COMPATIBLE-ENDPOINT
          BUCKET: your-content-bucket
        run: |
          SRC="$PWD/ServerData/iOS"
          [ -d "$SRC" ] || { echo "::error::ServerData/iOS missing, Addressables remote build did not run"; exit 1; }
          command -v rclone >/dev/null || { echo "::error::rclone not installed on runner"; exit 1; }
          # bundles first, catalog last: a half-upload must never reference missing bundles
          rclone copy "$SRC" "CDN:$BUCKET/iOS" --exclude "catalog*" --checksum -v
          # catalog keeps its filename while content changes, so it must never
          # cache at the edge; bundles are content-hashed and cache forever
          rclone copy "$SRC" "CDN:$BUCKET/iOS" --include "catalog*" --checksum -v \
            --header-upload "Cache-Control: no-store"
```

Two real-world traps this ordering prevents:

- Catalog uploaded before its bundles: fresh installs in that window
  resolve the new catalog and 404 on the bundles.
- Catalog cached at the edge: players get the old catalog with the new
  binary, which can stall first launch. Some ISPs and edges also block
  or cache shared dev domains oddly, so put remote content behind a
  domain you control.

## runner-smoke.yml (Phase 1)

```yaml
name: runner-smoke
on: workflow_dispatch
jobs:
  smoke:
    runs-on: [self-hosted, macOS, unity]
    steps:
      - name: Toolchain report
        run: |
          uname -m
          xcodebuild -version
          ls /Applications/Unity/Hub/Editor/
```

## signing-setup.yml (Phase 4, run once)

```yaml
# One-time (re-runnable) signing bootstrap: generates the Apple Distribution
# certificate + App Store provisioning profile into the encrypted certs repo
# via fastlane match. Run once after the Apple Developer account is set up,
# and again only if certs are revoked/expired. No Unity involved.
name: Signing setup

on:
  workflow_dispatch:

# Same group as the TestFlight workflow: both delete and recreate the same
# CI keychain, so they must never run at the same time.
concurrency:
  group: testflight
  cancel-in-progress: false

jobs:
  setup:
    runs-on: [self-hosted, macOS, unity]
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          clean: false

      - name: Add Homebrew tools to PATH (launchd services skip ~/.zprofile)
        run: |
          echo "/opt/homebrew/opt/ruby/bin" >> "$GITHUB_PATH"
          echo "/opt/homebrew/bin" >> "$GITHUB_PATH"

      - name: Install match deploy key
        env:
          MATCH_DEPLOY_KEY: ${{ secrets.MATCH_DEPLOY_KEY }}
        run: |
          KEY="$RUNNER_TEMP/match_deploy_key"
          printf '%s\n' "$MATCH_DEPLOY_KEY" > "$KEY"
          chmod 600 "$KEY"
          echo "GIT_SSH_COMMAND=ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" >> "$GITHUB_ENV"

      - name: Generate certs and profile (match, write mode)
        env:
          ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}
          ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}
          ASC_KEY_CONTENT: ${{ secrets.ASC_KEY_CONTENT }}
          MATCH_GIT_URL: ${{ secrets.MATCH_GIT_URL }}
          MATCH_PASSWORD: ${{ secrets.MATCH_PASSWORD }}
          CI_KEYCHAIN_PASSWORD: ${{ secrets.CI_KEYCHAIN_PASSWORD }}
        run: |
          bundle install
          bundle exec fastlane ios setup_signing
```

## testflight.yml (Phases 2, 3, 5)

```yaml
# iOS build -> TestFlight, on the self-hosted runner.
# Trigger from the Actions tab (Run workflow). With unsigned_check the pipeline
# stops after a signing-free xcodebuild compile of the exported project:
# useful before signing secrets exist and as a toolchain canary.
name: TestFlight

on:
  # Once the pipeline is trusted, uncomment to also ship on tags:
  # push:
  #   tags: ['ios-*']
  workflow_dispatch:
    inputs:
      unsigned_check:
        description: "Compile-only check (no signing, no upload)"
        type: boolean
        default: false
      release_notes:
        description: "TestFlight release notes (empty = auto-generate from recent commits)"
        type: string
        default: ""

concurrency:
  group: testflight
  cancel-in-progress: false

env:
  UNITY: /Applications/Unity/Hub/Editor/6000.3.10f1/Unity.app/Contents/MacOS/Unity
  LANG: en_US.UTF-8
  LC_ALL: en_US.UTF-8

jobs:
  build:
    runs-on: [self-hosted, macOS, unity]
    timeout-minutes: 120
    steps:
      - uses: actions/checkout@v4
        with:
          clean: false # keep Library/ between runs, a full reimport costs ~30 min
          fetch-depth: 0 # release notes read git log; a shallow clone has 1 commit

      - name: Add Homebrew tools to PATH (launchd services skip ~/.zprofile)
        run: |
          echo "/opt/homebrew/opt/ruby/bin" >> "$GITHUB_PATH"
          echo "/opt/homebrew/bin" >> "$GITHUB_PATH"

      - name: EditMode tests (gate)
        run: |
          "$UNITY" -batchmode -projectPath "$PWD" \
            -runTests -testPlatform EditMode \
            -testResults "$PWD/build/test-results.xml" -logFile -

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: editmode-test-results
          path: build/test-results.xml
          if-no-files-found: ignore

      - name: Export iOS Xcode project
        run: |
          "$UNITY" -batchmode -quit -projectPath "$PWD" -buildTarget iOS \
            -executeMethod CIBuild.BuildIOS -buildPath "$PWD/build/ios" -logFile -

      - name: Unsigned compile check
        if: inputs.unsigned_check
        run: |
          xcodebuild -project build/ios/Unity-iPhone.xcodeproj \
            -scheme Unity-iPhone -configuration Release \
            -destination "generic/platform=iOS" \
            CODE_SIGNING_ALLOWED=NO build

      - name: Install match deploy key
        if: ${{ !inputs.unsigned_check }}
        env:
          MATCH_DEPLOY_KEY: ${{ secrets.MATCH_DEPLOY_KEY }}
        run: |
          KEY="$RUNNER_TEMP/match_deploy_key"
          printf '%s\n' "$MATCH_DEPLOY_KEY" > "$KEY"
          chmod 600 "$KEY"
          echo "GIT_SSH_COMMAND=ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" >> "$GITHUB_ENV"

      - name: Sign and upload to TestFlight
        if: ${{ !inputs.unsigned_check }}
        env:
          ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}
          ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}
          ASC_KEY_CONTENT: ${{ secrets.ASC_KEY_CONTENT }}
          MATCH_GIT_URL: ${{ secrets.MATCH_GIT_URL }}
          MATCH_PASSWORD: ${{ secrets.MATCH_PASSWORD }}
          CI_KEYCHAIN_PASSWORD: ${{ secrets.CI_KEYCHAIN_PASSWORD }}
          RELEASE_NOTES_INPUT: ${{ inputs.release_notes }}
        run: |
          # Release notes: explicit input wins; otherwise the last 15 commit
          # subjects filtered to player-facing prefixes.
          if [ -n "$RELEASE_NOTES_INPUT" ]; then
            RELEASE_NOTES="$RELEASE_NOTES_INPUT"
          else
            RELEASE_NOTES=$(git log -15 --pretty='- %s' | grep -E '^- (fix|feat|content|balance|ui|ios)' | head -10 || true)
          fi
          [ -z "$RELEASE_NOTES" ] && RELEASE_NOTES="Bug fixes and improvements."
          export RELEASE_NOTES
          bundle install
          bundle exec fastlane ios beta

      - name: Keep the dSYM, drop the rest (disk fills otherwise)
        if: ${{ always() && !inputs.unsigned_check }}
        run: |
          # The dSYM is the only way to symbolicate TestFlight crash logs.
          # Keep it as a workflow artifact, then clear the heavy output.
          mkdir -p build/dsym
          cp build/output/*.app.dSYM.zip build/dsym/ 2>/dev/null || \
            echo "::warning::no dSYM found in build/output; crash logs will not symbolicate"
          rm -rf build/output

      - name: Upload dSYM artifact
        if: ${{ always() && !inputs.unsigned_check }}
        uses: actions/upload-artifact@v4
        with:
          name: dsym
          path: build/dsym
          if-no-files-found: ignore

      # Payload below is Discord's schema. For Slack, send {"text": "..."}
      # instead.
      - name: Notify (optional, needs BUILD_WEBHOOK secret)
        if: always()
        env:
          WEBHOOK: ${{ secrets.BUILD_WEBHOOK }}
          TEXT: "Build ${{ job.status }} (${{ inputs.unsigned_check && 'unsigned check' || 'TestFlight' }}) ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
        run: |
          [ -n "$WEBHOOK" ] || exit 0
          jq -n --arg content "$TEXT" '{content:$content, username:"CI"}' | \
            curl -s --max-time 15 -X POST \
              -H "content-type: application/json" --data-binary @- \
              "$WEBHOOK" -o /dev/null || true
```

## Design notes

- **`workflow_dispatch`, not push**: a 20-plus minute build on every push
  wastes the Mac. Ship builds when you decide to. Adding a
  `push: tags: ['ios-*']` trigger later is one line.
- **`concurrency` group**: two TestFlight builds at once would race on
  the build number and on the Unity project folder. The group queues
  them instead.
- **Tests as a gate**: EditMode tests run before the export. A red test
  stops the pipeline before it costs 20 minutes of build time. If the
  project has no tests yet, remove this step; a gate that always passes
  protects nothing.
- **`clean: false` everywhere**: keeps `Library/` between runs. First
  build imports everything once; later builds start warm.
- **`-logFile -`**: streams the Unity log into the Actions log, so a
  failed step shows the real error without SSH-ing into the Mac.
- **Release notes from commits**: keep commit subjects in the habit of
  starting with `fix:`, `feat:`, `content:` and testers get readable
  notes for free.
