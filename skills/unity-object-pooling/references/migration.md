# Migrating existing code to pools

Converting a live project is incremental work: one owner at a time, with a
check after each. Never a big-bang sweep. The diagnosis step
(deciding-and-diagnosing.md) produced a ranked list of hot sites; work
that list top down.

## Step 1: map the lifecycle of one candidate

For the chosen Instantiate/Destroy pair, answer:

1. **Who spawns?** That system becomes the pool owner.
2. **Who destroys?** Every `Destroy` call site becomes a `Despawn()` call.
   Grep for the type name to find them all:

```bash
# $SRC = the first-party roots from deciding-and-diagnosing.md step 1a
grep -rn --include="*.cs" "Projectile" $SRC | grep -E "Destroy|Instantiate"
```

3. **What state does a fresh instance rely on?** Everything `Instantiate`
   gave for free (prefab defaults) must now be restored by
   `ResetForPool()`. List the components on the prefab and walk the reset
   checklist in [pitfalls.md](pitfalls.md).
4. **Does anything hold references after death?** A list of active
   enemies, a targeting system, an event subscription. Those held
   references are exactly the bugs pooling exposes: after Release the
   object is alive in memory, so stale holders keep "working" on it.

If step 4 has messy answers, fix ownership first. Pooling a system with
unclear ownership turns a leak into data corruption.

## Step 2: convert

- Add the pool to the owner (`ObjectPool<T>` in `Awake`, `Clear` in
  `OnDestroy`, owner pattern in
  [gameobject-pooling.md](gameobject-pooling.md)).
- Replace `Instantiate(prefab, ...)` with `pool.Get()` plus position set.
- Replace every `Destroy(x)` with `x.Despawn()` (the guarded release from
  pitfalls.md section 2).
- Delete lifetime hacks that existed because Destroy was expensive
  (deferred destruction queues, "destroy budget per frame" lists). The
  pool replaces them.
- Keep `collectionCheck: true` during the whole migration.

## Step 3: verify before the next candidate

1. Compile clean.
2. Play the loop that uses the object. Spawn past `defaultCapacity`, past
   `maxSize`, then let everything die, then spawn again. Watch the console
   for `InvalidOperationException` (double release) and
   `MissingReferenceException` (destroyed instance in pool).
3. Run the GcSampler from deciding-and-diagnosing.md on the same loop as
   before the change: collections per interval should drop for this
   site's churn. If nothing moved, the site was not hot; consider
   reverting rather than keeping unjustified pool code.
4. Commit. One owner per commit keeps reverts cheap.

## Temp-collection migration

Cheaper than GameObjects, do these in batches per file:

- `new List<T>()` used and dropped in one method → `ListPool<T>.Get()` /
  `Release` (rules in [collection-pools.md](collection-pools.md)).
- LINQ chains in hot paths (`Where`, `Select`, `ToList`) → a loop writing
  into a pooled list. The LINQ garbage is usually why the site was hot.
- `GetComponentsInChildren<T>()` in a hot path → the non-allocating
  overload `GetComponentsInChildren(bool, List<T>)` writing into a
  pooled list.
- Physics queries → the `NonAlloc` variants with a persistent buffer
  owned by the caller (a pool is overkill for a fixed-size buffer; a
  plain field array is the right tool there).

## What not to migrate

- Objects the diagnosis never flagged.
- One-shot UI screens, scene furniture, singletons.
- Code whose ownership you cannot answer in step 1. Fix that first.
