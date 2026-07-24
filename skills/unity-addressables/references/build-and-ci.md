# Build and CI

## Order

Addressables content builds first, the player builds second. The player build
packs the local bundles from `Library/com.unity.addressables/aa` into the app.
If you build the player without building content, the app ships with stale or
missing bundles.

## Build content headless

Save and run with `unity command eval_file <file> --project-path <root>`:

```csharp
// Build Addressables content headless; report success or the error.
UnityEditor.AddressableAssets.Settings.AddressableAssetSettings.BuildPlayerContent(
    out UnityEditor.AddressableAssets.Build.AddressablesPlayerBuildResult result);
if (!string.IsNullOrEmpty(result.Error))
    return "BUILD FAILED: " + result.Error;
return "BUILD OK: bundles=" + result.AssetBundleBuildResults.Count + " out=" + result.OutputPath;
```

Always check `result.Error`. A compile error in the project makes the build
fail with an SBP error string, and nothing throws: the error only lives in the
result object. In a CI build method, exit nonzero on it:

```csharp
public static class CIBuild
{
    public static void BuildContent()
    {
        UnityEditor.AddressableAssets.Settings.AddressableAssetSettings.BuildPlayerContent(
            out var result);
        if (!string.IsNullOrEmpty(result.Error))
        {
            UnityEngine.Debug.LogError("Addressables build failed: " + result.Error);
            UnityEditor.EditorApplication.Exit(1);
        }
    }
}
```

Then from CI: `unity build <project> --target <t> --execute-method CIBuild.BuildAll`
where `BuildAll` builds content first, then calls `BuildPipeline.BuildPlayer`.
See the unity-cli skill for the full CI recipes (auth, license, build command).

## Verify with a real content build

The default play mode ("Use Asset Database") loads straight from source assets.
It is fast, and it hides every build mistake: missing entries, wrong groups,
broken remote paths. Before calling anything done:

1. Switch play mode to "Use Existing Build":

```csharp
var settings = UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject.Settings;
for (int i = 0; i < settings.DataBuilders.Count; i++)
    if (settings.DataBuilders[i] is UnityEditor.AddressableAssets.Build.DataBuilders.BuildScriptPackedPlayMode)
        settings.ActivePlayModeDataBuilderIndex = i;
UnityEditor.AssetDatabase.SaveAssets();
return "play mode = existing build";
```

2. Build content (snippet above).
3. Run a PlayMode test that loads one address and one label:

```csharp
[UnityEngine.TestTools.UnityTest]
public System.Collections.IEnumerator LoadsByAddress()
{
    var handle = UnityEngine.AddressableAssets.Addressables
        .LoadAssetAsync<UnityEngine.ScriptableObject>("game/readme");
    yield return handle;
    NUnit.Framework.Assert.AreEqual(
        UnityEngine.ResourceManagement.AsyncOperations.AsyncOperationStatus.Succeeded,
        handle.Status);
    UnityEngine.AddressableAssets.Addressables.Release(handle);
}
```

The test assembly (asmdef) needs references to `UnityEngine.TestRunner`,
`Unity.Addressables`, and `Unity.ResourceManager`, plus the
`UNITY_INCLUDE_TESTS` define constraint.

**Pipeline gotcha:** over the Unity CLI pipeline, PlayMode tests must run
async. Entering play mode reloads the domain and drops a synchronous request.

```bash
unity command run_tests --mode PlayMode --async_tests --project-path <root>
# poll until "status": "completed"
unity command test_status --project-path <root>
```

EditMode tests run fine synchronously.

**More verified traps around packed play mode tests:**

- Rebuild content after every script or asmdef change, right before the test
  run, with nothing changing in between. If the packed data is stale, play
  mode entry fails ("Player content must be built before entering play mode
  with packed data"), and the async test run then stays "running" forever.
  Recover with `unity command cancel_tests`.
- A cancelled play mode run can leave a dirty unsaved scene. The next content
  build then fails with `Unsaved scenes`. Recover by opening a fresh empty
  scene, then rebuild:

  ```csharp
  UnityEditor.SceneManagement.EditorSceneManager.NewScene(
      UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
      UnityEditor.SceneManagement.NewSceneMode.Single);
  return "clean scene";
  ```

- A test asmdef cannot reference `Assembly-CSharp`. Code under test must live
  in its own asmdef that the test asmdef lists in `references`. Note that
  `EditorUtility.scriptCompilationFailed` does not cover test assemblies:
  they compile on demand, so a broken test file surfaces only when tests run
  (the content build fails with an SBP error naming the file).

## Output paths

| Thing | Path |
|---|---|
| Local bundles + catalog | `Library/com.unity.addressables/aa/<Platform>` |
| Remote bundles + catalog | `ServerData/<Platform>` (see remote-content.md) |
| Content state file | `Assets/AddressableAssetsData/<Platform>/addressables_content_state.bin` |

`Library/...` is disposable cache. `ServerData/` is upload material.
The content state file is the anchor for later content updates: keep it.
