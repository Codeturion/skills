# Groups and labels

## Group strategy

Group by update behavior, not by asset type.

| Content | Group kind | Why |
|---|---|---|
| Bootstrap scene, core UI, anything needed before first load screen | Local | Must exist before any download can happen |
| Stable content that ships with the app | Local | No reason to pay download cost |
| Content that changes between releases (levels, configs, seasonal art) | Remote | Update without an app store release |
| Optional packs, DLC-style content | Remote, one group per pack | Ship and update independently |

Every entry gets an address. Give related entries a shared label when you load
them as a set (`packA`, `levels-forest`). Labels are how you load "all of X"
in one call.

## Create a group and add entries (headless)

Save and run with `unity command eval_file <file> --project-path <root>`:

```csharp
// Create a group, add an asset entry by GUID, set address and a label.
var settings = UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings;
if (settings == null) return "ERROR: no settings, run setup first";

var group = settings.FindGroup("GameContent");
if (group == null)
    group = settings.CreateGroup("GameContent", false, false, true, null,
        typeof(UnityEditor.AddressableAssets.Settings.GroupSchemas.BundledAssetGroupSchema),
        typeof(UnityEditor.AddressableAssets.Settings.GroupSchemas.ContentUpdateGroupSchema));

var guid = UnityEditor.AssetDatabase.AssetPathToGUID("Assets/Prefabs/Tower.prefab");
if (string.IsNullOrEmpty(guid)) return "ERROR: asset not found";

var entry = settings.CreateOrMoveEntry(guid, group);
entry.address = "game/tower";
settings.AddLabel("packA", true);
entry.SetLabel("packA", true, true);
UnityEditor.AssetDatabase.SaveAssets();
return "group=" + group.Name + " entry=" + entry.address + " labels=" + string.Join(",", entry.labels);
```

For many assets, loop over `AssetDatabase.FindAssets("t:Prefab", new[]{"Assets/Prefabs"})`
and call `CreateOrMoveEntry` per GUID. `CreateOrMoveEntry` also moves an entry
that already lives in another group, so re-running is safe.

## Scan recipes

### Cheap scan (no editor)

Group assets are plain YAML. From the project root:

```bash
# every entry with its address
grep -rn "m_Address" Assets/AddressableAssetsData/AssetGroups/

# which groups exist
ls Assets/AddressableAssetsData/AssetGroups/*.asset

# find the entry for one asset GUID
grep -rln "<guid>" Assets/AddressableAssetsData/AssetGroups/
```

### Full scan (editor)

```csharp
// Dump groups, local or remote, entries, addresses, labels.
var settings = UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings;
if (settings == null) return "no addressables settings";

var sb = new System.Text.StringBuilder();
foreach (var g in settings.groups)
{
    var bundled = g.GetSchema<UnityEditor.AddressableAssets.Settings.GroupSchemas.BundledAssetGroupSchema>();
    var loc = "[no bundle schema]";
    if (bundled != null)
        loc = bundled.BuildPath.GetName(settings) ==
            UnityEditor.AddressableAssets.Settings.AddressableAssetSettings.kRemoteBuildPath
            ? "[remote]" : "[local]";
    sb.AppendLine("group: " + g.Name + " " + loc);
    foreach (var e in g.entries)
        sb.AppendLine("  " + e.address + " <- " + e.AssetPath +
            (e.labels.Count > 0 ? "  labels: " + string.Join(",", e.labels) : ""));
}
return sb.ToString();
```

### Duplicate address check

Run this after big changes. Duplicate addresses do not fail the build. They
break at runtime, where a load by that address can return the wrong asset.

```csharp
var settings = UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings;
var seen = new System.Collections.Generic.Dictionary<string, string>();
var dups = new System.Text.StringBuilder();
foreach (var g in settings.groups)
    foreach (var e in g.entries)
    {
        if (seen.ContainsKey(e.address))
            dups.AppendLine("DUP: " + e.address + " in " + g.Name + " and " + seen[e.address]);
        else seen[e.address] = g.Name;
    }
return dups.Length == 0 ? "no duplicate addresses" : dups.ToString();
```

## Migrating off Resources

1. Scan for `Resources.Load` calls and list the assets they load.
2. Move each asset out of any `Resources/` folder (use `git mv`, keep the meta
   file with the asset).
3. Add entries for them (snippet above). Use the old Resources path as the
   address so call sites map one to one.
4. Replace each `Resources.Load<T>("x")` with an async Addressables load (see
   runtime-loading.md). There is no safe synchronous drop-in; plan for async.
5. Delete the empty `Resources/` folder. Then run the scan and the duplicate
   check.

## Known behaviors (verified)

- Deleting an asset from disk silently removes its entry on the next asset
  refresh. The build does not fail and nothing warns. If an address stops
  resolving after a delete, this is why.
- A major package upgrade (2.x to 3.x) can silently reset group build and
  load paths to Local while the remote catalog flag stays on. Rescan after
  upgrades (see setup.md).
- `CreateOrMoveEntry` does not validate the GUID. A GUID that matches no asset
  still creates an entry, with the raw GUID as its address. Always resolve the
  GUID from a real path first (`AssetDatabase.AssetPathToGUID`) and skip empty
  results, or you fill groups with dead entries.
