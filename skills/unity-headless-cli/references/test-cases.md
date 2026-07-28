# Verification record

Rig: Unity 6000.3.10f1 batchmode editor on macOS arm64 (M2 Pro), Unity CLI
1.0.0-beta.2, com.unity.pipeline, real production project. This record
was backfilled on 2026-07-28: the drive-side commands run daily on this
rig, and each claim below was re-run on that date. Bootstrap-side steps
were verified when this machine was set up and are marked as such.

## Drive commands (RE-RUN 2026-07-28)

- [x] `unity --version` → `1.0.0-beta.2`
- [x] `unity command --project-path <p>` lists the built-in tools
      (get_serialized_fields, find_assets, create_gameobject,
      delete_gameobject, set_component_properties, bake commands, ...)
- [x] Custom `[CliCommand]` methods appear in the same list with no
      registration step (5 project-defined tools visible next to the
      built-ins on the test project)
- [x] `create_gameobject --name X --components Light` creates the object
      and returns its GlobalObjectId and hierarchy path
- [x] `add_component --target X --type Rigidbody` adds the component.
      NOTE: parameters are `--target` and `--type`. An earlier version of
      this skill showed `--gameobject` / `--component`, which the server
      rejects with 400 Parameter Validation Failed. Fixed 2026-07-28.
- [x] `find_assets --name <n>` / `--type <TypeName>` / `--label <l>`
      return matches with paths and GUIDs; at least one filter is
      required. NOTE: an earlier version showed `--query "t:Prefab"`;
      there is no `--query` parameter and "Prefab" is not a resolvable
      type filter. Fixed 2026-07-28.
- [x] `delete_gameobject --target X` removes it (used as cleanup; the
      scene was not saved, so the project stayed untouched)
- [x] `unity command eval "return Application.unityVersion;"` returns
      the editor version; round-trips measured 200 to 600 ms all day
      under real load (dozens of eval and eval_file calls)
- [x] `eval_file <file.cs>` compiles multi-statement snippets with local
      functions and full engine API access on the editor main thread
- [x] The `unity pipeline list` quirk is real and verified in a stronger
      form: with TWO batchmode editors running and answering commands,
      the list showed zero reachable rows. Trust `unity command`, not
      the list.

## Bootstrap steps (verified at machine setup, not re-run)

- [x] CLI install via the official install script (this machine runs the
      result; the script itself was not re-executed for this record)
- [x] `unity pipeline install --project-path <p>` added
      `com.unity.pipeline` to the manifest of the projects on this
      machine; idempotence claim comes from the package being present
      and the command documented as a no-op, not from a re-run
- [x] Batchmode launch (`Unity -batchmode -projectpath <p> -logFile ...`
      with NO `-quit`) is the daily workflow on this rig; the
      GUI-hangs-over-SSH gotcha and the keychain-prompt hang were both
      hit for real on this machine before being written down

## Not verified

- `run_tests` was not re-run for this record (it runs the project's
  full test suite; exercised in past sessions, not on the record date).
- The install script and pipeline install were not re-executed (see
  above); re-verify on the next fresh machine.
