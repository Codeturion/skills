# Verification record

Rig: Unity 6000.3.10f1 batchmode editor on macOS arm64 (M2 Pro), Unity CLI
1.0.0-beta.2, com.unity.pipeline, real production project. This record
was backfilled on 2026-07-28: the drive-side commands run daily on this
rig, and each claim below was re-run on that date. Bootstrap-side steps
were verified when this machine was set up and are marked as such.

## beta.5 catch-up (RE-RUN 2026-08-22)

Rig: Unity CLI 1.0.0-beta.5, same editor version. Two editors: a real
project on com.unity.pipeline 0.4.0-exp.1, and a scratch project on
0.5.0-exp.1 launched with `Unity -batchmode -projectPath <p> -logFile <l>`.

- [x] `UNITY_PROJECT_PATH=<p> unity command eval "return Application.unityVersion;"`
      works with no `--project-path` flag
- [x] `unity command eval "return nope;"` exits 6 (compile error)
- [x] `unity command eval ...` with no editor running exits 6
- [x] `unity --format bogus editors list` exits 2 (usage error)
- [x] `--json`, `--no-pager`, `UNITY_NO_PAGER` are in `--help` of every command
- [x] `unity command --query gameobject --limit 3` filters the list on
      0.5.0. On 0.4.0 the same call fails: "does not support the listing
      flags. Update the package with unity pipeline install."
- [x] `unity command eval --code "..." --detach --json` returns a jobId
      on 0.5.0. On 0.4.0: "does not support detached jobs."
- [x] `unity job status <id>` shows running, `unity job wait <id> --json`
      blocks and returns the command result (42). `unity job cancel`
      exists in `--help`, not run.
- [x] `unity pipeline list-versions` lists 0.5.0-exp.1 as latest;
      `unity pipeline upgrade --project-path` exists
- [x] `unity editors running` and `unity pipeline list` both returned
      ZERO rows with two batchmode editors answering commands. The
      "trust unity command, not the list" gotcha now covers both.
- [x] `brew info --cask unity-cli` resolves (showed 1.0.0-beta.6)
- [x] `unity test --help` shows `--report-format nunit|junit`,
      `--junit-output`, `--coverage`, `--coverage-output`
- [x] `unity build --help` shows `--profile` and marks
      `--execute-method` optional
- [x] `unity run --help` shows `--command <name>` with args after `--`

### Not verified (2026-08-22)

- `unity run <project> --command eval -- --code "..."`: hung for 6 min
  with no editor process spawned. `unity doctor`, `unity auth status`,
  `unity license status`, `unity cloud status`, `unity projects create`
  hang the same way on this rig: no output, no CLI log line after
  startup, no socket, no child process, with `--non-interactive` and
  under a pty. Keychain reads succeed without a prompt, so this is NOT
  the stale-keychain case. Unity Hub was running at the time. Cause
  open. `unity run --command` is documented from `--help` only.
- `unity test --coverage`, `unity build --profile`: not run, documented
  from `--help`.

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
