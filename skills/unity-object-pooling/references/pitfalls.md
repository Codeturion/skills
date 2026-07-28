# Pitfalls and the reset checklist

Almost every pooling bug is one of four things: stale state, double
release, ghost work on a released object, or a destroyed-but-pooled
reference. All four are listed here with the fix.

## 1. Stale state: the reset checklist

A pooled object comes back exactly as it died. `SetActive(false)` stops
the object's own coroutines and its animation playback (and Animator
state is lost on disable by default), but it resets none of your fields
and none of the component state below.

Concrete example, verified on 6000.3: a particle effect that a tween
shrinks to `localScale = 0.1` before despawn comes back at 0.1 on the
next spawn, and a modified `ParticleSystem` module value (for example
`main.startSize` changed at runtime) also survives the SetActive cycle.
Anything a tween, a script, or an animation changed during the object's
life is still changed when the pool hands it out again. That is why the
checklist below exists, and why the tween itself must be killed by
target on release (section 3): a still-running shrink tween would keep
shrinking the object's NEXT life. Reset in `actionOnRelease`
(so objects sit clean) and walk this list for every component on the
pooled prefab:

| Component | Reset on release |
|---|---|
| Transform | position/rotation set on next spawn anyway; reset `localScale` if anything tweens it |
| Rigidbody | `linearVelocity = Vector3.zero; angularVelocity = Vector3.zero;` or the next spawn keeps the old momentum. Before Unity 6 the property is named `velocity` |
| Rigidbody2D | same, plus `Sleep()` if it should start asleep |
| TrailRenderer | exception to this table: `Clear()` on GET, not release, so the trail does not connect the old position to the new spawn |
| ParticleSystem | `Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear)` |
| Animator | `Rebind(); Update(0f);` back to entry state |
| AudioSource | `Stop(); clip = null;` if clips vary per spawn |
| LineRenderer | `positionCount = 0` |
| Health/ammo/timer fields | back to initial values, ideally one `Reset()` method on the script |
| Event subscriptions | unsubscribe anything subscribed in OnEnable/spawn; the object outlives the things it listens to |
| Static or manager references | null them; a pooled object holding a dead level's manager keeps that whole object graph alive |

The pattern that keeps this clean: one `ResetForPool()` method on the
pooled root script that the pool's `actionOnRelease` calls. New component
on the prefab = new line in that method. Reviewers can see it.

Two exceptions run on Get, not on Release: the double-release guard flag
(`OnSpawned()` sets `_released = false`; rearming it on Release would
reopen the double-release window) and `TrailRenderer.Clear()` (the row
above). Everything else resets on Release.

## 2. Double release

Symptoms: two systems act on "different" objects that are the same
instance; objects teleport; counts drift negative.

- Keep `collectionCheck: true`. Verified: the second Release throws
  `InvalidOperationException` immediately, at the call site that caused
  it. But this check runs ONLY in the Editor: Unity compiles it out of
  player builds, so on device every double release is silent and the pool
  stores the object twice. The Editor check finds the bug during
  development; the guard below is what protects the shipped game.
- Design rule that prevents it: exactly one place calls Release for a
  given object. If both a timer and a collision can end a projectile,
  both call one `Despawn()` on the object, and it guards:

```csharp
private bool _released;

public void OnSpawned() => _released = false;   // wired into actionOnGet

public void Despawn()
{
    if (_released) return;
    _released = true;
    _pool.Release(this);
}
```

## 3. Ghost work: coroutines, tweens, Invoke

`SetActive(false)` kills coroutines started on that MonoBehaviour. Two
things survive it:

- Coroutines started on ANOTHER runner
  (`manager.StartCoroutine(Fade(pooledThing))`): the coroutine keeps
  running against a released object that may already be respawned as
  something else. Rule: a pooled object never lets an outsider run
  routines against it; effects it needs, it runs itself, so deactivation
  cancels them.
- Tween libraries and `Invoke` schedules that are not tied to the
  GameObject's active state: kill them explicitly in `ResetForPool()`
  (for DOTween: `DOTween.Kill(transform)`; note free/paid is irrelevant,
  the rule is kill-by-target on release).

## 4. Destroyed objects inside a pool

If pooled instances get destroyed behind the pool's back (scene unload
while the pool lives, a stray `Destroy` call), the pool holds destroyed
Unity objects: `== null` is true but the reference is not C# null, and
`Get` returns it. Symptoms: `MissingReferenceException` on spawn after a scene
change.

- Owner and instances share a lifetime: pool cleared in the owner's
  `OnDestroy`, instances parented under the owner.
- Nobody calls `Destroy` on a pooled instance except the pool's own
  `actionOnDestroy`.
- Cross-scene pools need everything `DontDestroyOnLoad`, owner and
  instances both.

## 5. Domain reload and statics

With Enter Play Mode Options set to skip domain reload, static fields
survive between editor play sessions. Where pools stand was verified on
6000.3 with two play sessions and domain reload off:

- A plain user static field kept its value across sessions (it survives).
- Unity's own static pools (`ListPool` and friends) came back EMPTY: the
  engine clears its built-in static pools between sessions even without a
  domain reload. A list planted with grown capacity in session one was
  gone in session two.

So the built-in pools are safe here. The trap is your own statics: a
hand-rolled static pool, or a static cache next to your pools, keeps its
contents into the next play session and causes bugs that only happen on
the second Play press. Fix during development:
`[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]`
guard that resets your own static state, or turn domain reload back on
when hunting such a bug. One more consequence of the engine clearing its
pools: do not count on ListPool warm-up surviving a play session in the
editor.

## 6. Pooling Addressables instances

`Addressables.InstantiateAsync` pairs with `Addressables.ReleaseInstance`,
not `Destroy`. If pooled objects come from Addressables, the pool's
`actionOnDestroy` must call `Addressables.ReleaseInstance(go)`, or the
bundle's refcount never drops and the whole bundle stays in memory. The
unity-addressables skill covers the loading side; the rule here is only:
eviction path must release the handle.

## When NOT to pool

- Objects spawned rarely (a boss, a menu): pooling adds lifecycle bugs
  for zero measured gain.
- Scene-lifetime objects: the scene is the pool.
- Unity UI elements that trigger layout rebuilds: the rebuild costs far
  more than the allocation; fix the layout churn first. (The exception is
  a recycled scroll list, where pooling rows is the standard pattern and
  the list component manages the rebuilds.)
- Anything the diagnosis step (deciding-and-diagnosing.md) showed flat.
  Unproven pooling is complexity debt, not optimization.
