# Test cases: what was verified, where, and how

Everything this skill claims was executed before the PR opened. Environment:

- macOS (Apple Silicon), Unity 6000.3.10f1, Addressables 2.9.0, then the
  same suite repeated after an in-place upgrade to Addressables 3.1.0
- Unity CLI 1.0.0-beta.2 with com.unity.pipeline 0.4.0-exp.1
- Fresh project from `com.unity.template.urp-blank`, driven headless with
  `unity command eval` / `eval_file` against a `-batchmode` editor
- A production-scale Unity 6 project with the same Addressables version was
  used as the reference for the group strategy and CDN invariants

## Setup and groups

| Claim | How verified | Result |
|---|---|---|
| Settings creation snippet works | `eval_file` on fresh project | `Assets/AddressableAssetsData/AddressableAssetSettings.asset` created, default group present |
| Group + entry + label snippet works | `eval_file`, then scan | `group=GameContent entry=game/readme labels=packA`, ~235 ms round trip |
| Group YAML is greppable | `grep -rn "m_Address" Assets/AddressableAssetsData/AssetGroups/` | Entry addresses and GUIDs visible in plain text |
| Full scan snippet works | `eval_file` | Groups listed with `[local]`/`[remote]`, entries and labels correct |
| `CreateOrMoveEntry` does not validate GUIDs | Called it with a fake GUID | Entry created with the raw GUID as address (no null, no error) |
| Deleted assets are silently pruned | Deleted an entry's file behind the editor, refreshed, rebuilt | Entry gone from group, build OK, no warning |
| Duplicate addresses do not fail the build | Same address in two groups, rebuilt | Build OK; only runtime resolution is ambiguous |

## Runtime loading

| Claim | How verified | Result |
|---|---|---|
| Load by address works against a real content build | PlayMode test, play mode = Use Existing Build | Pass |
| Load by label works | PlayMode test with `LoadAssetsAsync("packA", null)` | Pass |
| The sample AssetLoaderService compiles and works | Copied verbatim from runtime-loading.md into the project, PlayMode test loads through it, checks the cache hit, releases | Pass (3/3 tests) |

## Build and CI

| Claim | How verified | Result |
|---|---|---|
| `BuildPlayerContent` works headless | `eval_file` build snippet | `BUILD OK: bundles=2` |
| Compile errors fail the build via `result.Error` | Added a broken .cs, rebuilt | `BUILD FAILED: SBP ErrorError`; nothing thrown, error only in result |
| PlayMode tests need `--async_tests` over the pipeline | Ran sync first | Error message says exactly that; async + `test_status` polling works |
| Stale packed data hangs the async test run | Changed scripts, ran tests without rebuilding content | Run stayed "running" forever; `cancel_tests` recovered it |
| Cancelled play mode run can block the next build | Rebuilt right after a cancel | `BUILD FAILED: Unsaved scenes`; fresh empty scene fixed it |

## Remote content

| Claim | How verified | Result |
|---|---|---|
| Remote flip snippet works | `eval_file`, then rebuild | `ServerData/StandaloneOSX/` with hashed bundle + `catalog_0.1.0.bin/.hash` |
| Any static host works | `python3 -m http.server 8787` as `Remote.LoadPath` | Catalog and bundle served with HTTP 200, PlayMode tests pass |
| The download is real, not a cache hit | Stopped the server and cleared the cache, reran tests; restarted server, reran | 2/2 fail without server, pass with it |
| Content update produces new hashed bundles and rewrites the catalog in place | Modified an asset, ran `ContentUpdateScript.BuildContentUpdate` | New bundle beside the old one, same catalog file name, new content |

## Versions and platforms

| Claim | How verified | Result |
|---|---|---|
| Latest-version lookup snippet works | `Client.Search` via eval | Returned `3.1.0` as latestCompatible |
| `Client.Resolve()` applies a manifest bump in a running editor | Bumped 2.9.0 to 3.1.0, resolved, checked `PackageInfo` | Version live without editor restart; `AssetDatabase.Refresh()` alone did not apply it |
| Everything above works on 3.x | Reran settings, group, scan, build, remote flip, and all 3 PlayMode tests on 3.1.0 | All pass |
| Major upgrade can reset remote groups to Local | Scanned after the 2.9.0 to 3.1.0 upgrade | GameContent build/load paths back to Local, `BuildRemoteCatalog` still true |
| Per-platform ServerData and content state | Switched the project to iOS headless, rebuilt content | `ServerData/iOS/` with own bundle + catalog, `AddressableAssetsData/iOS/addressables_content_state.bin` beside the OSX one |

## Not verified here

- On-device loading on a phone (the download flow was verified on desktop
  against a local server; iOS was verified up to the content build)
- Unity CCD (out of scope, see remote-content.md)
