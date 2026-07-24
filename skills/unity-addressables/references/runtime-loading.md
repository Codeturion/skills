# Runtime loading

## The one rule

Every load returns an `AsyncOperationHandle`. Keep it. Release it when the
asset is no longer needed. Releasing the handle is what lets Unity unload the
bundle. Losing handles is why Addressables projects leak memory.

## Load patterns

```csharp
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;

// by AssetReference (preferred: survives asset moves and renames)
AsyncOperationHandle<GameObject> handle = reference.LoadAssetAsync<GameObject>();
GameObject prefab = await handle.Task;

// by string address
AsyncOperationHandle<Sprite> spriteHandle = Addressables.LoadAssetAsync<Sprite>("ui/icon");
Sprite icon = await spriteHandle.Task;

// everything with a label, one call
AsyncOperationHandle<System.Collections.Generic.IList<LevelConfig>> packHandle =
    Addressables.LoadAssetsAsync<LevelConfig>("packA", null);
var configs = await packHandle.Task;

// release: always through the handle you kept
Addressables.Release(handle);
```

Check `handle.Status == AsyncOperationStatus.Succeeded` before using the result
when the load can fail (remote content, user content).

For prefabs you place in the world, `Addressables.InstantiateAsync` pairs with
`Addressables.ReleaseInstance(instance)`. Use it when you want instance
counting; use `LoadAssetAsync` + `Object.Instantiate` when one loaded prefab
spawns many instances.

## A small loading service (verified to compile and pass tests)

One service owns all handles. Callers never see a handle and can never leak
one. Register it in your composition root or DI container; the game code
depends on the class, not on Addressables.

```csharp
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;

public class AssetLoaderService
{
    private readonly Dictionary<string, AsyncOperationHandle> _handles = new();

    public async Task<T> Load<T>(string address) where T : Object
    {
        if (_handles.TryGetValue(address, out var cached))
            return (T)cached.Result;

        var handle = Addressables.LoadAssetAsync<T>(address);
        await handle.Task;

        if (handle.Status != AsyncOperationStatus.Succeeded)
        {
            Addressables.Release(handle);
            throw new System.InvalidOperationException("Addressables load failed: " + address);
        }

        _handles[address] = handle;
        return handle.Result;
    }

    public async Task<IList<T>> LoadByLabel<T>(string label) where T : Object
    {
        var key = "label:" + label;
        if (_handles.TryGetValue(key, out var cached))
            return (IList<T>)cached.Result;

        var handle = Addressables.LoadAssetsAsync<T>(label, null);
        await handle.Task;

        if (handle.Status != AsyncOperationStatus.Succeeded)
        {
            Addressables.Release(handle);
            throw new System.InvalidOperationException("Addressables label load failed: " + label);
        }

        _handles[key] = handle;
        return handle.Result;
    }

    public void Release(string address)
    {
        if (!_handles.TryGetValue(address, out var handle)) return;
        Addressables.Release(handle);
        _handles.Remove(address);
    }

    public void ReleaseAll()
    {
        foreach (var handle in _handles.Values)
            Addressables.Release(handle);
        _handles.Clear();
    }
}
```

Notes:

- The cache means a second `Load` of the same address is free and does not
  create a second handle.
- `ReleaseAll` on scene teardown or game exit is the safety net.
- If two callers can request the same address at the same time, store the
  handle in the dictionary before the `await` instead of after, and await the
  stored handle's `Task`. That removes the double-load race.

## Scenes

```csharp
var sceneHandle = Addressables.LoadSceneAsync("levels/forest",
    UnityEngine.SceneManagement.LoadSceneMode.Additive);
await sceneHandle.Task;
// later
await Addressables.UnloadSceneAsync(sceneHandle).Task;
```

Unloading the scene through Addressables releases its dependencies. Unloading
it through SceneManager does not.

## Symptoms and causes

| Symptom | Cause |
|---|---|
| `InvalidKeyException` | Address typo, or content not built for this play mode |
| Memory climbs across scene loads | Handles never released, or scene unloaded via SceneManager |
| Sprite goes pink or white after a while | Its handle was released while still in use |
| Same asset loaded twice in a profiler snapshot | Two systems load it separately; route both through the service |
