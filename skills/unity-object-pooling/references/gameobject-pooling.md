# Pooling GameObjects and prefabs

The owner pattern: the system that spawns owns the pool. No pool manager,
no singleton, no registry, no scene scanning. A weapon owns its projectile
pool. A wave controller owns its enemy pool.

Measured baseline (Unity 6000.3 editor batchmode, 2000 cube spawn+kill):
naive Instantiate+DestroyImmediate 28.3 ms, warm pool with SetActive
5.6 ms. Most of that gap is native engine cost: creating and destroying
the native object, its components, and its transform registration.
Managed garbage from the wrapper objects is the smaller part. The naive
number uses `DestroyImmediate` because the editor cannot run deferred
`Destroy`; in players `Destroy` defers destruction to end of frame, so
per-call cost differs there and was not measured. What holds everywhere:
spawn and destroy pay real native work, and the destroyed instances add
managed garbage on top.

## The owner component

```csharp
using UnityEngine;
using UnityEngine.Pool;

public class ProjectileSpawner : MonoBehaviour
{
    [SerializeField] private Projectile _prefab;
    [SerializeField] private int _expectedPeak = 64;

    private ObjectPool<Projectile> _pool;

    private void Awake()
    {
        _pool = new ObjectPool<Projectile>(
            createFunc: CreateInstance,
            actionOnGet: p => { p.OnSpawned(); p.gameObject.SetActive(true); },
            actionOnRelease: p => { p.ResetForPool(); p.gameObject.SetActive(false); },
            actionOnDestroy: p => Destroy(p.gameObject),
            collectionCheck: true,
            defaultCapacity: _expectedPeak,
            maxSize: _expectedPeak * 2);
    }

    private Projectile CreateInstance()
    {
        Projectile p = Instantiate(_prefab, transform);
        p.Init(_pool);           // the instance keeps the pool to release itself
        return p;
    }

    public Projectile Spawn(Vector3 position, Quaternion rotation)
    {
        Projectile p = _pool.Get();
        p.transform.SetPositionAndRotation(position, rotation);
        return p;
    }

    private void OnDestroy() => _pool.Clear();
}
```

The pooled object releases itself through the pool reference it was given,
not through a static lookup:

```csharp
public class Projectile : MonoBehaviour
{
    private IObjectPool<Projectile> _pool;
    private bool _released;

    public void Init(IObjectPool<Projectile> pool) => _pool = pool;

    // Get side: rearm the guard. Nothing else belongs here.
    public void OnSpawned() => _released = false;

    // Release side: reset ALL state, walk the checklist in pitfalls.md.
    public void ResetForPool()
    {
        // rigidbody velocity, trails, timers, subscriptions, own fields
    }

    public void Despawn()
    {
        if (_released) return;   // OnCollisionEnter can fire more than once per step
        _released = true;
        _pool.Release(this);
    }

    private void OnCollisionEnter(Collision _) => Despawn();
}
```

One rule, stated once and followed everywhere in this skill: **state
resets on Release** (`ResetForPool()` in `actionOnRelease`, so objects sit
clean in the pool). Exactly two things happen on Get instead: the
`_released` guard rearms (`OnSpawned()`), and `TrailRenderer.Clear()` runs
if there is a trail (see [pitfalls.md](pitfalls.md)). The guard cannot
rearm on Release: that would reopen the double-release window it exists
to close.

The `_released` guard matters: collision callbacks, timers, and kill
triggers can all end the same object in the same frame, and player builds
have no double-release check (see [pitfalls.md](pitfalls.md) section 2).
`Despawn()` is public because every old `Destroy(x)` call site becomes
`x.Despawn()` during migration.

## Decisions that matter

- **SetActive, not reparenting.** Toggling active state is the cheap
  on/off switch. Keep instances under one parent (the spawner) and leave
  them there. Reparenting on every spawn adds transform work for nothing.
- **Deactivate-on-release resets some things for free.** `OnDisable` runs,
  coroutines on the object stop, animations halt. It does NOT reset
  transform, rigidbody velocity, trail renderers, or your fields. Walk the
  checklist in [pitfalls.md](pitfalls.md).
- **`actionOnDestroy` must destroy the GameObject.** The pool only forgets
  the reference; without `Destroy(p.gameObject)` evicted instances stay in
  the scene forever, inactive.
- **Awake vs OnEnable on the pooled prefab:** `Awake` runs once on first
  Instantiate. `OnEnable` runs on every `Get` (via SetActive). One-time
  setup goes in `Awake`, per-spawn setup in `OnEnable` or `actionOnGet`.
- **Scene unload:** the owner's `OnDestroy` calls `_pool.Clear()`. Pooled
  instances are scene objects, so the scene unload destroys them anyway,
  but Clear keeps the pool honest if the owner dies before the scene.
- **Do not pool across scenes** unless the owner and instances are all
  `DontDestroyOnLoad`. Half-and-half leaves the pool holding destroyed
  Unity objects, which are `== null` but not C# null, and the next `Get`
  hands out a destroyed object.

## Particles, trails, audio

Effects want a release-by-callback, not a timer:

- `ParticleSystem`: set Stop Action to `Callback` and release in
  `OnParticleSystemStopped`.
- `TrailRenderer`: call `Clear()` in `actionOnGet`, or the trail draws a
  line from its old position to its new spawn.
- `AudioSource`: release when `isPlaying` turns false, checked from the
  owner, not with a coroutine on the pooled object (see ghost-coroutine
  pitfall).
