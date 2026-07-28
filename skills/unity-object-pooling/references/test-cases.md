# Verification record

Rig for every entry: Unity 6000.3.10f1, macOS arm64 (M2 Pro), batchmode
editor, Mono JIT, eval on the editor main thread via unity-cli. Editor
numbers rank and compare; they are not player timings. IL2CPP players use
the same Boehm collector, so the GC-behavior claims carry; the timings do
not.

## Timings: 5-run medians (VERIFIED 2026-07-28, pool_bench_reps.cs)

200k get/release cycles per case, warmed 2000 cycles, forced full GC
before each timed run, naive/pooled order alternated between reps.
Median and range of 5:

| Case | Median | Range |
|---|---|---|
| naive new List<float>(64) | 27.6 ms | 26.6-30.1 |
| ObjectPool<List> | 2.4 ms | 2.4-2.7 |
| same pool via IObjectPool reference | 2.4 ms | 2.3-2.7 |
| ListPool<float> | 2.5 ms | 2.4-3.2 |
| LinkedPool<List> | 8.5 ms | 8.4-8.6 |
| GenericPool<List> | 9.5 ms | 9.1-9.9 |
| naive new Dictionary<int,int>() | 32.1 ms | 31.8-33.6 |
| DictionaryPool<int,int> | 11.3 ms | 11.2-11.9 |
| naive new HashSet<int>() | 32.9 ms | 32.3-40.4 |
| HashSetPool<int> | 11.6 ms | 11.5-12.3 |

Conclusions the skill quotes:

- ObjectPool and ListPool ~11x faster than naive, zero garbage.
- IObjectPool dispatch cost not measurable at this resolution (equal
  medians). "Free" is more than the data shows; say "not measurable".
- LinkedPool ~3.5x slower than ObjectPool on List payloads; an earlier
  tiny-object single run measured 7x (1.5 vs 10.6 ms). Range disclosed
  in content as "3.5x, worse for small payloads".
- GenericPool ~4x slower than an owned ObjectPool. Gap replicates across
  all 5 reps; cause not isolated (do not claim a mechanism).
- Dictionary and HashSet pools ~3x faster than naive.

### Superseded single-run anomaly, kept as a methodology lesson

The first single-run head-to-head (pool_bench_all.cs, same day) measured
HashSetPool at 51.8 ms, SLOWER than naive (36.9 ms), and that number
briefly became a headline claim ("collection pools buy zero GC, not
always raw speed"). The 5-rep rerun shows pooled HashSet clearly faster
(11.6 vs 32.9 medians). The 51.8 was single-run noise on a churned heap.
Lesson recorded: no ratio ships from a single run; medians of 5 with
alternated order are the minimum. Same applies to that run's using-scope
number (22.0 vs 3.2 ms, ~7x); not re-measured with reps, so content says
"several times slower" instead of a tight ratio.

Garbage produced by the naive loops (pool_bench_all.cs, GetTotalMemory
delta, dead-but-uncollected garbage, not retained memory): List 59 MB,
Dictionary 30 MB, HashSet 17 MB. All pooled loops: zero.

## GameObject baseline (VERIFIED 2026-07-28, pool_bench.cs, single run)

2000 cube spawn+kill: naive Instantiate+DestroyImmediate 28.3 ms, warm
ObjectPool with SetActive on/off 5.6 ms. DestroyImmediate because
batchmode cannot run deferred Destroy; player Destroy defers work to end
of frame and was not measured. Content states this, attributes most of
the measured gap to native engine cost (create/destroy of native object,
components, transform registration), and keeps managed garbage as the
secondary effect.

## Boehm GC: fragmentation and cache locality (VERIFIED 2026-07-28)

Scripts: pool_bench_frag.cs (superseded), pool_bench_frag2.cs
(order-controlled rerun), pool_bench_cache2.cs (single-run, directional).

### Fragmentation under churn (order-controlled rerun, pool_bench_frag2.cs)

40 rounds x 5000 mixed-size allocations (16 B to 4 KB), 5% survive
long-term, same seed per paired arm. Run in BOTH orders (naive-first
twice, pooled-first once) after a review agent flagged the original
fixed-order run as confounded on a non-shrinking heap. Results
replicated across orders:

| | Time (3 runs) | GC collections | Used heap after full GC | Live survivor data |
|---|---|---|---|---|
| naive churn | 98-102 ms | 1 each | +30/31/30 MB | 10 MB |
| pooled churn (per-size ObjectPool) | 12 ms all | 0 each | +17 MB all | 10 MB |

Content quotes: footprint ~3x live vs ~1.7x pooled, ~8x faster, zero
collections. (The original fixed-order run had shown 13x and +15 MB;
order control moderated both, which is why it superseded.) Attribution
limits, disclosed: "used after full GC" is GC.GetTotalMemory, whose
excess over live data mixes conservative retention and free-block
accounting; the reserved-memory counter was also sampled but editor-wide
reserved deltas were too noisy to attribute (observed -64 to +220 MB
swings between arms). So content says "heap footprint ~3x live data",
not "holes". The 1-vs-0 collections column is editor-heap-masked
(multi-GB editor heap absorbs churn); on a device-sized heap the naive
arm would collect far more often, which strengthens the pooling case.

### Cache locality: contiguous vs scattered allocation

1M x 64 B plain nodes (64 MB payload, larger than Apple SLC), 3 passes.
"Contiguous" = allocated back to back (pool warm-up style). "Scattered" =
allocated interleaved with dead garbage, collected before measuring:

| Traversal | Contiguous | Scattered | Penalty |
|---|---|---|---|
| sequential | 18.1 ms | 24.9 ms | +38% |
| random order (same permutation) | 60.6 ms | 66.9 ms | +10% |

Scope: at 100k x 64 B (6.4 MB, fits in cache) the effect was NOT
measurable. Claim locality for large hot sets of plain C# data only;
GameObject access is dominated by engine-side native cost and was not
measured for this effect.

### LIFO reuse

2M reuse cycles over 8192 pooled 64 B objects: LIFO stack 35.2 ms vs
FIFO queue 52.2 ms (~1.5x). Attribution caveat: the proxy compares
Stack<T> vs Queue<T>, so container overhead is part of the delta, and
the 512 KB working set fits in cache, so the experiment as designed
cannot separate cache effects from container cost at all. The cache-hot
direction is asserted from mechanism, not shown by this data; content
uses the claim only softly (warm-up rationale).

## Method notes

- Heap deltas via GC.GetTotalMemory around the loop after a forced full
  collect. GetTotalMemory-after-loop measures garbage produced (dead but
  uncollected), not retained memory; content must not say "left on the
  heap". GC.GetAllocatedBytesForCurrentThread returns 0 on Mono; never
  use it for claims (pool_bench.cs's per-thread columns are dead for this
  reason; its timings and the GetTotalMemory reruns are the sources).
- Boehm has no generations. GC.CollectionCount(0) counts full
  collections. Never write "gen0" in skill content.
- Benchmark scripts were session-scoped and are not preserved with the
  skill; the descriptions above (sizes, counts, seeds, warm-up, GC
  brackets, order control) are the reproduction recipe.
- Disclosure: in the median-of-5 run the owned ObjectPool/LinkedPool were
  constructed with collectionCheck: false while the static pools ran with
  the editor check on. ListPool (check on) matched ObjectPool (check off)
  at ~2.4-2.5 ms, so the check cost at shallow pool depth is small, but
  it was not isolated.
- "Garbage produced" figures are lower bounds (GetTotalMemory after the
  loop; a mid-loop collection would under-report, and collection counts
  were not recorded in that script).
- "Order alternated" in the median-of-5 protocol means forward/reverse of
  one fixed sequence, not full permutation.

## API semantics (VERIFIED 2026-07-28, pool_semantics.cs + pool_bench_reps.cs)

- [x] ObjectPool<T> 7-arg constructor compiles and runs as written
- [x] collectionCheck: true → second Release of same object throws
      InvalidOperationException ("Trying to release an object that has
      already been released")
- [x] collectionCheck: false → double release SILENT, CountInactive=2 with
      the same object stored twice
- [x] Editor-only scope of the check: official 6000.3 constructor docs
      state collection checks run only in the Editor and not in player
      builds (verified via the unity-api doc server, 2026-07-28). All
      content phrases the protection as Editor-only; the guarded Despawn
      is the player-side answer.
- [x] Static ListPool double release THROWS InvalidOperationException in
      the editor (shared pools have the check on). Verified live
      2026-07-28 after a review agent caught the draft claiming the
      opposite; in player builds the check compiles out and the double
      release is silent (follows from the doc line above).
- [x] maxSize=2, release 3 → CountInactive=2, actionOnDestroy fired once,
      CountAll=2 (created minus destroyed)
- [x] using (pool.Get(out item)) auto-releases on scope exit
      (CountInactive 0 inside, 1 after)
- [x] LinkedPool<T>, GenericPool<T>, ListPool/DictionaryPool/HashSetPool
      Get/Release round-trips (exercised by the benchmarks)
- [x] ProfilerRecorder GC counters headless: "GC Reserved Memory",
      "GC Used Memory", "GC Allocated In Frame" all Valid; CurrentValue
      populated (1678/1524 MB on the live editor, a real 154 MB
      reserved-vs-used gap); Used cross-checks GC.GetTotalMemory exactly.
      LastValue reads 0 without a frame tick: skill says use CurrentValue.
- [x] Rigidbody.linearVelocity (Unity 6 name; `velocity` before, noted in
      content) and ParticleSystemStopAction.Callback /
      OnParticleSystemStopped confirmed against 6000.3 API index
- [x] Owner-pattern scripts (ProjectileSpawner + Projectile from
      gameobject-pooling.md) compiled as real .cs files in a production
      Unity 6000.3 project: zero errors, both types present in
      Assembly-CSharp. Files removed after the check. (2026-07-28)
- [x] GetComponentsInChildren<T>(bool, List<T>) non-alloc overload exists:
      confirmed by reflection on the live editor. (2026-07-28)
- [x] Stale state survives the SetActive cycle: localScale set to 0.1 and
      a runtime-modified ParticleSystem main.startSize (0.05) both kept
      their values after SetActive(false)/SetActive(true). The reused
      object comes back exactly as it died. (2026-07-28)

## Play-mode checks (VERIFIED 2026-07-28, PoolPlayVerify.cs, empty scene, batchmode)

- [x] Ghost coroutine repro: victim's OWN coroutine stopped by
      SetActive(false) (0 ticks after), a coroutine run by an OUTSIDER
      runner kept executing against the deactivated object (3 ticks
      after). Pitfall 3 claim confirmed exactly.
- [x] Domain reload statics, run TWICE (B and C series), Enter Play Mode
      Options = DisableDomainReload, two play sessions each:
      - Control: plain user static field kept its value (777) across
        sessions. No domain reload happened.
      - Unity's static ListPool came back EMPTY both times: a list
        planted with Capacity=12345 in session one was not returned in
        session two (fresh list, Capacity=0). The engine clears its
        built-in static pools between play sessions even with domain
        reload off. Pitfall 5 written to match: built-in pools safe,
        user statics are the trap, and editor ListPool warm-up does not
        survive a session.
      Editor settings restored after (enterPlayModeOptionsEnabled=false).

## Review trail

2026-07-28: dogfood agent run (5 workflow bugs found and fixed), then a
3-reviewer wave (hostile senior dev 8/10, skill-design 8/10, GC/perf
expert 6/10). All BLOCKER/MAJOR findings fixed, including two behavior
errors the wave caught: collectionCheck framed as dev-build protection
(it is Editor-only) and the static-pool double-release claim (it throws;
the draft said silent). Timings re-measured as 5-run medians in response
to the methodology finding, which also overturned the HashSetPool-slower
single-run anomaly.

2026-07-28 round 2 (4 fresh cold reviewers: hostile dev 8/10,
skill-design 7.5/10, GC expert 8/10, 1-year amateur 6/10). Fixed: the
reset-callback contradiction (unified as state-reset-on-Release,
OnSpawned guard rearm on Get, identical wiring in all files), the
collection-pools ~3x/~11x number contradiction, LinkedPool memory pitch
debunked (references-only backing array, eviction frees in both types),
Despawn made public to match migration, warm-up snippet given a concrete
type, fragmentation experiment re-run order-controlled with used/reserved
attribution (this section), thread-safety warning added, warm-pool
live-set cost added, beginner fast path added, theory rewritten as plain
bullets, SetActive absolutes softened, recycled-scroll-list exception
noted. One reviewer corroborated the domain-reload static-pool clearing
by finding the engine mechanism via reflection (PoolManager reset hooks).

All checks closed. Nothing in this skill is unverified.
