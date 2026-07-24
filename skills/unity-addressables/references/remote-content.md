# Remote content

Serve content from any static file host and update it without an app release.
No specific vendor is required: S3, R2, GCS, or a plain web server all work.
Unity's paid CCD service also works but is out of scope here; if the project
uses Unity Gaming Services, see the build-live-game skill.

## 1. Turn on the remote catalog and make a group remote

```csharp
// Turn on the remote catalog and move one group to remote build/load paths.
var settings = UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings;
if (settings == null) return "ERROR: no settings";

settings.BuildRemoteCatalog = true;
settings.RemoteCatalogBuildPath.SetVariableByName(settings,
    UnityEditor.AddressableAssets.Settings.AddressableAssetSettings.kRemoteBuildPath);
settings.RemoteCatalogLoadPath.SetVariableByName(settings,
    UnityEditor.AddressableAssets.Settings.AddressableAssetSettings.kRemoteLoadPath);

// Point the remote load URL at your host (local test server here).
var pid = settings.activeProfileId;
settings.profileSettings.SetValue(pid, "Remote.LoadPath", "http://localhost:8787/[BuildTarget]");

var group = settings.FindGroup("GameContent");
var bundled = group.GetSchema<UnityEditor.AddressableAssets.Settings.GroupSchemas.BundledAssetGroupSchema>();
bundled.BuildPath.SetVariableByName(settings,
    UnityEditor.AddressableAssets.Settings.AddressableAssetSettings.kRemoteBuildPath);
bundled.LoadPath.SetVariableByName(settings,
    UnityEditor.AddressableAssets.Settings.AddressableAssetSettings.kRemoteLoadPath);
UnityEditor.EditorUtility.SetDirty(settings);
UnityEditor.AssetDatabase.SaveAssets();
return "remote catalog on, GameContent remote, LoadPath=" +
    settings.profileSettings.GetValueByName(pid, "Remote.LoadPath");
```

`[BuildTarget]` expands per platform (`StandaloneOSX`, `iOS`, `Android`), so
one profile serves every platform from one bucket.

After the next content build, `ServerData/<Platform>/` holds:

- `<group>_assets_all_<contenthash>.bundle` (one per bundle)
- `catalog_<version>.bin` and `catalog_<version>.hash`

## 2. The three hosting invariants

These are what make remote content safe. They hold on every host.

1. **Upload bundles before the catalog.** The catalog is the index. If clients
   see a new catalog before its bundles exist, loads fail. Bundles first,
   catalog last, always.
2. **The catalog must never be cached.** It keeps its file name between
   updates and is rewritten in place. Serve `catalog_*` with
   `Cache-Control: no-store` (or at least `no-cache`).
3. **Bundles are immutable.** Their file names contain a content hash; a new
   build with changed content produces a new file name. Serve them with a long
   cache lifetime. Never overwrite an existing bundle file.

Generic upload that respects the order, with rclone (any S3-style host or
local path; swap in `aws s3 cp`, `gsutil`, or scp the same way):

```bash
# 1. bundles first, checksum-based so unchanged files are skipped
rclone copy ServerData/iOS remote:bucket/iOS --checksum --exclude "catalog_*"

# 2. catalog last, marked never-cache
rclone copy ServerData/iOS remote:bucket/iOS --include "catalog_*" \
  --header-upload "Cache-Control: no-store"
```

## 3. Test locally before touching a real host

```bash
cd ServerData && python3 -m http.server 8787
```

With `Remote.LoadPath` pointing at `http://localhost:8787/[BuildTarget]`,
build content, then run the PlayMode load test from build-and-ci.md. To prove
the download is real and not a cache hit: stop the server, clear the cache
(`UnityEngine.Caching.ClearCache()`), and confirm the same test fails; restart
the server and confirm it passes.

## 4. Ship a content update

An update rebuilds only what changed, against the state of the last full
release. That state lives in
`Assets/AddressableAssetsData/<Platform>/addressables_content_state.bin`.
Commit it with each release. If it is lost, you cannot ship an update against
the old catalog; you can only do a full new release.

```csharp
// Ship a content update against the last release's content state file.
var settings = UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings;
var statePath = UnityEditor.AddressableAssets.Build.ContentUpdateScript.GetContentStateDataPath(false);
if (!System.IO.File.Exists(statePath)) return "ERROR: no content state at " + statePath;

var result = UnityEditor.AddressableAssets.Build.ContentUpdateScript.BuildContentUpdate(settings, statePath);
if (result == null || !string.IsNullOrEmpty(result.Error))
    return "UPDATE FAILED: " + (result == null ? "null result" : result.Error);
return "UPDATE OK: bundles=" + result.AssetBundleBuildResults.Count;
```

After the update build, `ServerData` contains the new hashed bundles next to
the old ones, and the catalog rewritten in place. Upload with the same
bundles-first script. Old bundles stay for users who have not updated their
catalog yet; prune them once no live catalog references them.

Clients pick up the new catalog on next launch. Groups marked with the
Content Update Group Schema as "Cannot change post release" are protected from
accidental changes; "Can change post release" groups are the update surface.
