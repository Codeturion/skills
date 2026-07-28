---
name: unity-addressables
description: Use when a Unity project needs the Addressables system. Install and set up the package, move assets off Resources or direct references, organize assets into groups and labels, load and release assets at runtime, build Addressables content headless or in CI, host content on a CDN or static server, or ship content updates without a new app release. Also use for Addressables errors like InvalidKeyException, assets that stay in memory, or content that works in the editor but fails in a build.
---

# Unity Addressables

Addressables is Unity's system for packing assets into bundles, loading them by
address at runtime, and updating content after release. This skill covers setup,
daily use, builds, and remote content. Everything runs headless. No menu paths.

## Requirements

- Unity 6 (verified on 6000.3) and Addressables 2.x or 3.x (verified on
  2.9.0 and 3.1.0).
- The Unity CLI with a running headless editor, so `unity command eval` works.
  If the project is not set up for that yet, use the **unity-headless-cli** skill first.
- To add the package headless, use the **unity-package-management** skill, or
  follow the latest-version lookup in [references/setup.md](references/setup.md).

## Step 1: Ask before touching anything

The answers decide which reference files apply. Ask all five, then follow the
route table.

1. **New setup or migration?** Is Addressables already installed, or does the
   project load assets with Resources, direct references, or AssetBundles today?
2. **Does content need to update after release?** If all content can ship inside
   the build, the remote path is not needed.
3. **If remote: what host?** Any static file host works (S3, R2, GCS, a plain
   web server). None yet is fine: start with a local test server.
4. **Which content changes often?** Content that changes often goes in remote
   groups. Stable content stays local.
5. **Which platforms?** Content builds are per platform. Each platform gets its
   own ServerData folder.

| Answer | Read |
|---|---|
| Not installed yet | [references/setup.md](references/setup.md) |
| Assets not in groups, or migrating off Resources | [references/groups-and-labels.md](references/groups-and-labels.md) |
| Writing or fixing loading code | [references/runtime-loading.md](references/runtime-loading.md) |
| Build, CI, or "works in editor, fails in build" | [references/build-and-ci.md](references/build-and-ci.md) |
| Content updates after release, CDN, remote catalog | [references/remote-content.md](references/remote-content.md) |

## Step 2: Scan before you touch

Never assume the project's Addressables layout. Get ground truth first.

- **Cheap scan, no editor.** The group files under
  `Assets/AddressableAssetsData/AssetGroups/*.asset` are plain YAML. Grep them
  for entries, addresses, and labels:

  ```bash
  grep -rn "m_Address" Assets/AddressableAssetsData/AssetGroups/
  ```

- **Full scan, via the editor.** Query `AddressableAssetSettings` with
  `unity command eval` for groups, local or remote schemas, and duplicate
  addresses. Ready snippets are in
  [references/groups-and-labels.md](references/groups-and-labels.md).
- If `docs/addressables.md` exists in the project, read it for the intended
  layout, then confirm with a scan. Update it after changes.

**Eval gotcha:** code passed to `unity command eval` compiles as a method body.
`using` directives are not allowed there. Fully qualify every name
(`UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings`).

## Step 3: Core rules (always apply)

- Every load has a matching `Addressables.Release`. Keep the handle, release
  the handle. Handle leaks are the most common Addressables bug.
- Load through one small service class, not scattered calls. Cache loaded
  assets there and release on teardown. A verified sample service is in
  [references/runtime-loading.md](references/runtime-loading.md).
- Prefer `AssetReference` fields over string addresses. The inspector keeps
  them valid when assets move. Strings break silently.
- Group by update behavior, not by asset type. Things that change together
  ship together.
- Never mix Addressables and Resources for the same asset. One asset, one
  loading path.
- The build does not protect you from everything. A deleted asset's entry is
  silently pruned, and duplicate addresses build fine but break at runtime.
  Run the duplicate check from the scan snippets after big changes.

## Step 4: Verify the result

- Switch the play mode script to "Use Existing Build", build content, then run
  a PlayMode test that loads by address. Exact commands are in
  [references/build-and-ci.md](references/build-and-ci.md).
- The "Use Asset Database" play mode hides build mistakes. Never call a bundle
  verified from it.
- For remote content, serve `ServerData/<platform>` from a local static server
  and confirm the catalog and one bundle download. Walkthrough in
  [references/remote-content.md](references/remote-content.md).

## Troubleshooting map

| Symptom | Usual cause | Fix in |
|---|---|---|
| `InvalidKeyException` | Address or label typo, or content not built | groups-and-labels.md |
| Memory grows every scene change | Handles never released | runtime-loading.md |
| Works in editor, fails in build | Asset Database play mode masked a missing entry | build-and-ci.md |
| Load hangs or fails only on device | Remote host unreachable, or wrong load path | remote-content.md |
| Remote clients get stale content | Catalog cached by the CDN | remote-content.md |
| Update shipped, nothing changed | Catalog uploaded before bundles, or content state file lost | remote-content.md |
| Wrong asset returned for an address | Duplicate address in two groups | groups-and-labels.md |
