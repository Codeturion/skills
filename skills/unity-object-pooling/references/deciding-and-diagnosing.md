# Deciding and diagnosing: is pooling needed, and where

Pooling without a measured problem is itself an anti-pattern. This file is
the core of the skill: find candidates by grep, confirm with numbers,
decide with the table. Never skip to the fix.

## Why this matters on Unity in particular

The facts that drive every decision below, in plain words:

- Unity's garbage collector is called Boehm. The editor (Mono) and device
  builds (usually IL2CPP) both use it.
- Its heap does not compact. When objects die, the holes they leave
  between still-alive objects ("survivors") stay holes forever.
- The heap rarely shrinks. Once it grows to fit a spike, plan on it
  keeping that size.
- Collection cost grows with heap size. A bigger heap means slower scans.
- Editor vs device: the editor compiles code while it runs (JIT), device
  builds compile ahead of time (AOT). Same collector, different code
  speed. So the GC behavior claims in this skill carry to device, timing
  ratios can shift there, and absolute millisecond numbers do not
  transfer between machines at all.
- **Incremental GC** (Project Settings > Player > Use Incremental GC, on
  by default in new projects) slices collection work across frames. It
  changes the symptom (spread cost instead of one big hitch), not the
  disease. `GC.Collect()` is always a full blocking collection. Check
  this setting before interpreting hitch patterns.

Measured consequence (editor, replicated across both run orders; tables
in [test-cases.md](test-cases.md)): mixed-size churn with 5% survivors
ended with a heap footprint about 3x its live data; the same pattern
pooled ended near 1.7x, ran ~8x faster, and triggered zero collections.
On phones that footprint gap is what makes the OS kill the app in the
background.

## Step 1: grep for the causes

Fast path: if the problem object is already known (the stutter happens
when coins, bullets, or one specific effect spawns), skip the greps, go
straight to Step 2, and confirm with the sampler. The greps exist to FIND
candidates; a known burst site is already a candidate.

Fragmentation needs three ingredients: churn, size variety, and survivors
pinning the heap. All three are greppable. But scope the search first, or
most hits will be noise.

**1a. Scope to first-party code.** Do not guess folder names; projects
put code anywhere (`Assets/Scripts`, `Assets/<Studio>/<Game>`, ...).
Measure where the scripts are:

```bash
find Assets -name "*.cs" -not -path "*Plugins*" -not -path "*Editor*" \
  | cut -d/ -f1-3 | sort | uniq -c | sort -rn | head
```

The folders with high counts that are clearly the project's own code (not
store assets, SDKs, or imported packages) are your source roots. Set the
shell variable now and reuse it in every later command (repeat the
commands per folder if there are several):

```bash
SRC="Assets/YourGame/Scripts"   # your folder from the count above
```

When in doubt, ask the user which folders are theirs. Exclude from all
later greps:

- Third-party and vendor folders (store assets, SDKs, `Plugins/`). Their
  allocations are not this task's job to fix.
- `Editor/` folders and `*Editor*.cs`: editor code never runs in a build.

Then check for existing pooling code INSIDE those first-party roots
(third-party libraries often ship their own pools; those do not count):

```bash
grep -rln --include="*.cs" -E "class [A-Za-z]*Pool|ObjectPool<" $SRC | grep -v Editor
```

If that hit list is not empty, the project already pools. Read those
classes before anything else and see "Projects that already pool" below.
`Instantiate` inside a pool class is the pool working, not churn: exclude
those files from the churn greps too.

**1b. Run the greps** over the first-party folders only (`$SRC` below):

```bash
# Allocation inside per-frame methods (churn)
grep -rn --include="*.cs" -E "void (Update|FixedUpdate|LateUpdate)" -A 30 $SRC \
  | grep -E "new (List|Dictionary|HashSet|StringBuilder)|new [A-Za-z]+\[|\.ToList\(|\.ToArray\(|\.Where\(|\.Select\("

# Instantiate/Destroy churn in gameplay code
grep -rn --include="*.cs" -E "Instantiate\(|CreatePrimitive\(|new GameObject\(" $SRC | grep -viE "editor|test|pool"
grep -rn --include="*.cs" -E "Destroy\(.*\)" $SRC | grep -viE "editor|test|pool|OnDestroy"

# Variable-size allocations (size variety, the fragmentation multiplier)
grep -rn --include="*.cs" -E "new byte\[[a-z_]|new [A-Za-z]+\[[a-z_]" $SRC

# String garbage in hot paths
grep -rn --include="*.cs" -E '\+ ".*"|string\.Format|\$"' $SRC | grep -iE "update|tick|frame"
```

Also check coroutines and physics callbacks (`OnTriggerEnter`,
`OnCollisionStay`): they run per frame or per contact and hide the same
patterns. And check event handlers that fire in bursts (rewards,
purchases, celebrations, wave spawns): a handler that spawns dozens of
objects per event is churn even though no `Update` is involved.

**1c. Rank the hits** by reading the surrounding code, the grep line alone
cannot tell frequency: **how often it runs x how variable the size**. A
`new List` in one `Update` on one object is nothing. A `new byte[n]` with
dynamic `n` in a manager that ticks every frame is the first target. Burst
sites rank by objects-per-event times events-per-session.

## Projects that already pool

Production projects often have a pooling service already. Do not bolt a
second system next to a working one:

- If the existing pool covers a candidate site, route the site through it.
  Consistency beats this skill's own patterns.
- Add an owned `ObjectPool<T>` only for sites the existing system does not
  fit (wrong lifecycle, wrong layer, or the service is scene-bound and the
  site is not).
- The "no pool manager" rule in this skill is about not INTRODUCING a god
  object where none exists. It is not an instruction to dismantle a
  working service.

## Step 2: confirm with numbers

The one-number fragmentation signal on a non-compacting heap: **GC
Reserved Memory climbing while GC Used Memory stays flat**. Reserved is
what the process holds, Used is what live objects need. A widening gap is
holes.

Sampler (verified headless on 6000.3, counters report valid values and
Used cross-checks against `GC.GetTotalMemory` exactly):

```csharp
using Unity.Profiling;
using UnityEngine;

public class GcSampler : MonoBehaviour
{
    ProfilerRecorder _reserved;
    ProfilerRecorder _used;
    int _collections;
    float _next;

    void OnEnable()
    {
        _reserved = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Reserved Memory");
        _used = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Used Memory");
        _collections = System.GC.CollectionCount(0);
    }

    void Update()
    {
        if (Time.unscaledTime < _next) return;
        _next = Time.unscaledTime + 5f;
        int c = System.GC.CollectionCount(0);
        // this log line itself allocates; the 5 s interval keeps that negligible
        Debug.Log($"GC reserved {_reserved.CurrentValue / 1048576} MB, " +
                  $"used {_used.CurrentValue / 1048576} MB, " +
                  $"collections +{c - _collections} in 5s");
        _collections = c;
    }

    void OnDisable() { _reserved.Dispose(); _used.Dispose(); }
}
```

Drop it on any object, play the loop the greps pointed at (a combat wave,
a menu open and close cycle, a level load) for a few minutes, read the log.
Note: `CurrentValue`, not `LastValue`. `LastValue` needs a frame tick and
reads 0 in batchmode evals.

Measurement rules that keep the numbers honest:

- **The measurement needs PLAY MODE with the suspect loop actually
  running.** The counters themselves work headless (verified), but a
  sampler running while the game idles in a menu, or in a headless editor
  with no game loop, measures nothing about the candidates. In CI, drive
  the loop with automated play (play-mode tests or an input harness) or
  defer measurement to a manual session.
- **Burst sites need their moment played.** A purchase celebration only
  allocates during a purchase. Trigger each ranked site several times
  while sampling, or its churn is invisible.
- **A big editor heap masks collections.** An editor that has grown to
  gigabytes absorbs churn that would collect every few seconds on a
  512 MB device heap. Editor numbers rank sites; device numbers decide.
  When possible, run the sampler in a development build on the target
  device.
- If you sample through a headless eval harness instead of a script,
  fully qualify names (`Unity.Profiling.ProfilerRecorder`): eval snippets
  reject top-level `using` directives.

Boehm has no generations: `GC.CollectionCount(0)` counts full collections.

If the **unity-profiling** skill is installed, use it instead for deep
capture (call-stack attribution, frame-time diffs), then come back here to
decide. This sampler is the standalone path. For seeing the heap itself
(fragmentation snapshots, reserved-vs-used over time, what holds what),
Unity's Memory Profiler package (`com.unity.memoryprofiler`) is the
dedicated tool.

## Step 3: decide

| Observation | Meaning | Action |
|---|---|---|
| Collections climbing, hitches line up with them | Churn | Pool the top-ranked grep hits |
| Spikes only when a specific event fires (purchase, wave, celebration) | Burst churn | Pool that event's spawn site |
| Reserved-vs-used gap widening over minutes | Fragmentation | Pool the variable-size sites first |
| Both flat WHILE the suspect loop and bursts were actually played | No problem | Do not pool. Stop here |
| Both flat but the loop was not running (menu idle, headless, wrong scene) | No signal, not no problem | Fix the measurement, do not conclude |
| Reserved high but stable since startup | One-time startup burst | Usually fine; warm up pools during loading if it bothers |

"No signal is not no problem" is the row that prevents the confident wrong
answer. The stop row only applies when the evidence covers the thing the
greps accused.

## Sizing and warm-up

See the "Sizing and warm-up" section of
[objectpool-basics.md](objectpool-basics.md), next to the implementation
content.
