# Setup

One-time steps. All idempotent, safe to re-run. Needs a running headless editor
(see the unity-headless-cli skill).

## 1. Install the package

Install the latest `com.unity.addressables`. Ask the editor for the newest
compatible version:

```csharp
var req = UnityEditor.PackageManager.Client.Search("com.unity.addressables");
while (!req.IsCompleted) System.Threading.Thread.Sleep(100);
return req.Result[0].versions.latestCompatible;
```

Then add that version to `Packages/manifest.json` and force the running
editor to resolve it:

```csharp
UnityEditor.PackageManager.Client.Resolve(); return "resolving";
```

`AssetDatabase.Refresh()` alone does not re-resolve packages in a running
editor; `Client.Resolve()` does. Confirm with
`UnityEditor.PackageManager.PackageInfo.FindForPackageName("com.unity.addressables").version`.
This skill was verified on 2.9.0 and 3.1.0; both behave the same for
everything documented here.

**Upgrading an existing project across a major version (2.x to 3.x):** the
upgrade can silently reset group build and load paths back to Local while
`BuildRemoteCatalog` stays on. After any major upgrade, run the full scan
(groups-and-labels.md) and re-apply remote paths where they were lost.

## 2. Create the settings asset

Save as `create_settings.cs` and run
`unity command eval_file create_settings.cs --project-path <root>`:

```csharp
// Create AddressableAssetSettings if the project has none (idempotent).
// eval code is a method body: no using directives, fully qualify names.
var settings = UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings;
if (settings == null)
{
    settings = UnityEditor.AddressableAssets.Settings.AddressableAssetSettings.Create(
        UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.kDefaultConfigFolder,
        UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.kDefaultConfigAssetName,
        true, true);
    UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings = settings;
}
return "settings at: " + UnityEditor.AssetDatabase.GetAssetPath(settings);
```

Expected result: `settings at: Assets/AddressableAssetsData/AddressableAssetSettings.asset`.
This also creates a Default Local Group and the profile system.

## 3. Version control

Commit `Assets/AddressableAssetsData/` (settings, groups, profiles). Never
commit:

- `ServerData/` (build output for remote content)
- `Library/com.unity.addressables/` (local build cache)

Add both to `.gitignore`. The one exception: keep
`Assets/AddressableAssetsData/<Platform>/addressables_content_state.bin` under
version control if you ship content updates. Losing it breaks the update chain
(see remote-content.md).

## 4. Write the project memory doc

Create `docs/addressables.md` in the project with:

- the group list and what each group holds
- which groups are local and which are remote
- where the loading service lives
- the remote host and load path, if any

Add one line to the project's CLAUDE.md pointing at it. Future agent sessions
then see the layout at a glance. The scan (SKILL.md step 2) stays the source of
truth; this doc is the summary. Keep it current after group changes.
