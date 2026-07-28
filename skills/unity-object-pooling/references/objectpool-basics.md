# The six pool types and the interface

Everything lives in `UnityEngine.Pool`, core engine since 2021.1. All
numbers below were measured on Unity 6000.3; method in
[test-cases.md](test-cases.md).

## ObjectPool<T>: the default

A stack of instances. `Get` pops or creates, `Release` pushes back.

```csharp
using UnityEngine.Pool;

var pool = new ObjectPool<Projectile>(
    createFunc: () => new Projectile(),   // required
    actionOnGet: p => p.Activate(),       // optional
    actionOnRelease: p => p.Reset(),      // optional, reset here
    actionOnDestroy: p => p.Dispose(),    // optional, fires on eviction and Clear
    collectionCheck: true,
    defaultCapacity: 32,                  // initial stack capacity, not pre-created objects
    maxSize: 128);
```

Verified semantics:

- `collectionCheck: true`: releasing the same object twice throws
  `InvalidOperationException`. With `false` the double release is silent
  and the pool stores the same object twice, which hands it out to two
  callers later. Keep the check on. Important limit: Unity runs this
  check ONLY in the Editor and compiles it out of player builds, so on
  device every double release is silent no matter the flag. The guarded
  `Despawn()` in [pitfalls.md](pitfalls.md) is the player-side protection.
- `maxSize` caps the stored (inactive) count, never the live count.
  Releasing into a full pool calls `actionOnDestroy` on the object.
- `defaultCapacity` only sizes the internal stack. It does not create
  objects. Warm-up is your job (see Sizing and warm-up below).
- Counters: `CountActive`, `CountInactive`, `CountAll` (created minus
  destroyed). Use `CountActive` peaks to size the pool.
- `Clear()` destroys all stored objects. Call it when the owner dies.
- Cost: ~2.4 ms per 200k get/release cycles (median of 5 runs; editor,
  Mono, M2 Pro), zero garbage. The same loop with `new` was ~28 ms and
  produced 59 MB of garbage for the collector to clean up.

`Get` has a second form that returns a disposable scope:

```csharp
using (pool.Get(out var item))
{
    // item auto-releases at the end of the using block (verified)
}
```

Convenient and exception-safe, but measured several times slower than a
manual Get/Release pair (still zero garbage). Use it in cold paths, not
in per-frame loops.

## LinkedPool<T>: almost never

Same interface, but items are stored as linked nodes instead of a stack
array. The usual pitch is "no big backing array, memory can shrink". That
pitch is weaker than it sounds: the backing array it avoids holds only
references (8 bytes per slot, ~80 KB even for a 10k burst), object memory
is freed by `maxSize` eviction in BOTH pool types, and LinkedPool caches
its internal nodes rather than trimming. The price is real: ~3.5x slower
per cycle (median 8.5 vs 2.4 ms per 200k; a tiny-object run measured up
to 7x). Prefer ObjectPool unless profiling on the target device says
otherwise.

## GenericPool<T>: prototypes only

A static, engine-owned `ObjectPool<T>` per type. Zero setup:

```csharp
var thing = GenericPool<MyThing>.Get();
GenericPool<MyThing>.Release(thing);
```

Measured ~4x slower than an owned ObjectPool (median 9.5 vs 2.4 ms; the
gap replicates across runs, its cause is not isolated), and it is global
state: every script sharing the type shares the pool, with no owner, no
Clear on scene change, and no reset callbacks. Fine for prototype code.
In production code, own your pool.

## ListPool, DictionaryPool, HashSetPool: everyday tools

Static pools for temporary collections. This is the piece most projects
should adopt first, because temp collections are everywhere:

```csharp
var results = ListPool<RaycastHit>.Get();
// fill, read, then:
ListPool<RaycastHit>.Release(results);   // clears the list for you
```

Numbers (medians of 5 runs per 200k cycles; editor, Mono, M2 Pro; full
record in [test-cases.md](test-cases.md)):

| Pool | Pooled | Naive new | Naive garbage produced |
|---|---|---|---|
| ListPool<float> | 2.5 ms | 27.6 ms | 59 MB |
| DictionaryPool<int,int> | 11.3 ms | 32.1 ms | 30 MB |
| HashSetPool<int> | 11.6 ms | 32.9 ms | 17 MB |

All three win on time and produce zero garbage. Ratios travel; absolute
times are rig-specific.

Rules:

- Never store a pooled collection in a field. Get, use, release, same
  scope.
- Never return a pooled collection to a caller. Copy out first.
- `Release` clears the collection, so no data leaks between users.

## IObjectPool<T>: the test seam

Both ObjectPool and LinkedPool implement `IObjectPool<T>` (`Get`,
`Release`, `Clear`, `CountInactive`). Depend on the interface in systems
you want to test:

```csharp
public class Spawner
{
    private readonly IObjectPool<Enemy> _pool;
    public Spawner(IObjectPool<Enemy> pool) { _pool = pool; }
}
```

MonoBehaviours cannot have constructors; there, take the interface
through an `Init(IObjectPool<T> pool)` method instead, like the
Projectile sample in [gameobject-pooling.md](gameobject-pooling.md).

Measured: the dispatch cost is not measurable next to the pool work
itself (2.4 ms via interface, 2.4 ms concrete, medians of 5). In tests,
hand in a fake that counts Get/Release balance; an unbalanced count is
the most common pooling regression.

## Sizing and warm-up

- `defaultCapacity`: your expected steady-state count. Count it: log
  `pool.CountActive` peak during a real play session.
- `maxSize`: the burst ceiling you are willing to keep in memory. Releases
  beyond it destroy the object (verified: `actionOnDestroy` fires). For
  pooled GameObjects remember the native side: an inactive pooled instance
  still holds its native memory (meshes, components), so on low-memory
  devices size `maxSize` from total instance cost, not managed bytes.
  And every pooled object is permanently live for the collector: a big
  warm pool grows the live set that each full collection must scan, and
  the footprint the OS sees. Warm up what the game uses, not a safety
  margin on top of a safety margin.
- Warm up during a loading screen, not on first spawn:

```csharp
// example for a Projectile pool; use your own pooled type
var warm = new Projectile[expectedPeak];
for (int i = 0; i < expectedPeak; i++) warm[i] = pool.Get();
for (int i = 0; i < expectedPeak; i++) pool.Release(warm[i]);
```

For plain C# pooled data, warm-up is also a cache measure: objects created
back to back sit nearly contiguous, and a burst of `Get`s walks them in
order (measured on plain object traversal, for working sets larger than
CPU cache; GameObject access is dominated by engine-side cost, so do not
expect the same there; see [test-cases.md](test-cases.md)).

Anything smarter than hand sizing (adaptive growth, telemetry, memory
pressure response) is out of scope here; see the closing section of
SKILL.md.
