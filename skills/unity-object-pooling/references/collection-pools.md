# Collection pools: ListPool, DictionaryPool, HashSetPool

Temporary collections are the most common garbage in Unity code: a list
built inside a method, filled, read, and dropped. Every one feeds the
collector, and mixed with survivors and varied sizes it fragments the
non-compacting heap. The collection pools end that without changing how
the code reads.

## Daily use

```csharp
using UnityEngine.Pool;

// direct form, fastest, zero garbage
List<Enemy> inRange = ListPool<Enemy>.Get();
FindEnemiesInRange(transform.position, _radius, inRange);
Enemy closest = PickClosest(inRange);
ListPool<Enemy>.Release(inRange);   // Release clears it

// using-scope form, exception-safe, several times slower, still zero garbage
using (ListPool<Enemy>.Get(out List<Enemy> list))
{
    FindEnemiesInRange(transform.position, _radius, list);
}   // auto-released here (verified)
```

Pick the form by how hot the path is: `using` in cold code (UI clicks, level
load), direct Get/Release in per-frame code.

`DictionaryPool<K,V>` and `HashSetPool<T>` work identically.

## Performance

Measured wins over allocating: ListPool ~11x, DictionaryPool and
HashSetPool ~3x, all with zero garbage. The measured table lives in
[objectpool-basics.md](objectpool-basics.md), the full record in
[test-cases.md](test-cases.md). What you buy on top of speed is zero
fragmentation pressure on the non-compacting heap.

One hard limit for all of `UnityEngine.Pool`: **not thread-safe**. Get
and Release only on the main thread. A static `ListPool` touched from a
job, a task continuation, or any worker thread is silent shared-state
corruption.

## Rules

1. **Same scope in, same scope out.** Get and Release live in the same
   method. If that is hard, the collection is not temporary, give it a
   real owner field instead (a plain collection, allocated once).
2. **Never return a pooled collection.** The caller cannot know it must
   release. Copy into a caller-provided collection or return a plain one.
3. **Never store a pooled collection in a field.** After the next Get
   somewhere else, your field and that caller share the same list and
   overwrite each other. These bugs look like data corruption and are
   slow to track down.
4. **Do not release twice.** Verified: in the Editor the shared pools
   throw `InvalidOperationException` on a double release, treat it as a
   Get/Release imbalance and fix the code. In player builds Unity
   compiles the check out, so the same bug is silent on device: the pool
   stores the list twice and hands it to two call sites.
5. **Capacity survives release.** A list that grew to 10k stays 10k in the
   pool. That is a feature (no regrowth next time) and a risk (one giant
   frame pins the memory). If a rare code path builds huge lists, use a
   local `new` there instead of filling the shared pool with oversized
   collections.
