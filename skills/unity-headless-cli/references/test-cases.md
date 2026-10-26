# Verification record

Newest section first. Older sections keep the command names of their
date; from 0.9.0-exp.1 on, every command is `<group> <name>`.

## Package 0.9.0-exp.1 catch-up (RE-RUN 2026-10-27)

Rig: Unity 6000.3.10f1 batchmode editor (`-batchmode -nographics`,
no `-quit`) on macOS arm64, scratch project created with `-createProject`,
`unity pipeline install --package-version 0.9.0-exp.1`. Unity CLI
1.0.0-beta.8 (`~/.unity/bin/unity`, curl install). The brew cask is
beta.6, the CDN latest-beta.json says beta.14. The CLI upgrade is a
machine change and was NOT done for this record.

Grouped commands, all exit 0 with the expected result:

- [x] `script eval "return 2+2;"` returns 4; `script eval_file <file>`
      returns the file's value
- [x] `gameobject create --name Spawner` creates `/Spawner`.
      NOTE: `--components` no longer exists ("gameobject has no
      parameter --components", exit 2). Removed from the docs. Add
      components with `component add`.
- [x] `component add --target Spawner --type Rigidbody` (and `Light`)
- [x] `asset find --name MyPipelineCommands` returns path, GUID, type
- [x] `gameobject delete --target Spawner`
- [x] `test list`, `test run --mode EditMode` (0 tests, Summary block),
      `test run --mode PlayMode --async_tests` (result "running"),
      `test status` ("completed"), `test cancel` ("cancelled")
- [x] `lighting bake --detach --json` returns a jobId; `unity job wait
      <id> --json` returns `"command": "lighting bake"`
- [x] `script recompile` ("up_to_date"), `script.methodreload status`
      ("Method Reload Status", the new name)
- [x] `editor status` (ready, playMode, runInBackground fields),
      `editor set_auto_tick --enable true`,
      `editor.playmode set_run_in_background --enable true`,
      `editor.playmode start` (status "playing"), `editor.playmode stop`
      NOTE: the switch is `--enable`, not `--enabled` (exit 2 with a
      "Did you mean --enable?" hint).
- [x] `build list_platforms` lists installed platforms with ids
- [x] `capture screenshot` answers (success:false, "No camera found",
      scratch scene has no camera; the command itself resolves)
- [x] `unity command script` lists the group with full names and the
      `script.methodreload` subgroup. `unity command --query gameobject
      --limit 3` filters.
- [x] `--omit-nulls` drops `"output":null` from the eval result.
      `--verbose` and `--timeout 5` are accepted on beta.8 (both are also
      global CLI flags there, so no visible change on a passing call).

Old names:

- [x] `unity command create_gameobject --name Old` exits 6: "Command Not
      Found. No command named 'create_gameobject' is available. It was
      renamed: run 'unity command gameobject create'."
- [x] `unity command eval "return 2+2;"` STILL RUNS (bare name that
      matches exactly one command). Documented as a trap, not a feature:
      always write the group.
- [x] `unity command --obsolete-command-names` on beta.8: flag ignored,
      prints the plain list. The list on beta.8 shows bare names with no
      group column. The server endpoint
      `/api/commands?detail=obsolete_names` returns 170 rows, same as
      `Editor/ObsoleteCommandNames.json` in the package tarball.

Custom commands (file in `Assets/Editor`, no asmdef):

- [x] `[CliCommand("mytool", "validate_content", "...", MainThreadRequired = false)]`
      runs as `unity command mytool validate_content --strict true`
      (returns 1); `[CliCommand("mytool", "spawn_marker", "...")]` as
      `mytool spawn_marker --name Waypoint` (creates the object)
- [x] `[CliCommand("legacy_ping", "...")]` (two arguments) compiles with
      `warning CS0618: ... obsolete: 'Name the command's group:
      [CliCommand(group, name, description)]. With only a name the
      command is registered in the 'global' group.'` and runs as both
      `unity command legacy_ping` and `unity command global legacy_ping`
- [x] The namespace is still `Unity.Pipeline.Commands`; the assembly is
      `Unity.Pipeline.Attributes`. `using Unity.Pipeline.Attributes;`
      fails with CS0234. There is no `[MainThreadRequired]` attribute
      type in 0.9.0: it is a property of `CliCommand`. The old example
      in this skill used the attribute form and was fixed.
- [x] A compile error in `Assets/Editor` made the batchmode editor exit
      during start-up with only `error CS...` lines in the log and no
      pipeline descriptor. Added as a gotcha.

Server:

- [x] `curl http://127.0.0.1:7801/api/status` with the bearer token: 200.
      Same request to `http://localhost:7801`: 400. Same request to
      127.0.0.1 with `Host: evil.test`: 400 "Bad Request (Invalid host)".
- [x] The descriptor `Library/Pipeline/.unity-pipeline-port` carries
      `capabilities` including `commands.obsoleteNames` and an
      `endpoints` list.

Observed, not in the docs:

- `script eval "return nope;"` exits 0 on CLI beta.8 with
  `"success":false,"error":"Compilation Failed"` inside the result. The
  2026-08-22 record saw exit 6 on beta.5. Treat the exit code of eval
  compile errors as CLI-version dependent and parse the JSON.
- `unity pipeline list-versions` listed 0.9.1-exp.1 (2026-10-22) as
  latest on the record date. Its changelog un-deprecates the
  two-argument `[CliCommand]`: a dotted name is read as group plus name.
  The rename table is identical to 0.9.0. Not run.

### Not verified (2026-10-27)

- Unity CLI 1.0.0-beta.14: not installed. `--obsolete-command-names`
  output, and the grouped `unity command` listing, are documented from
  the package docs and the 0.9.0 changelog only.
- `unity run --command`: still hangs on this rig (see 2026-08-22). Not
  re-run.
- Play Mode runtime server listed in the Editor descriptor: not checked,
  not claimed in the docs.
- The Addressables snippets were not re-run on 0.9.0; see that skill's
  record.


## beta.5 catch-up (RE-RUN 2026-08-22, flat command names of 0.5.0)

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
  the stale-keychain case. Same on CLI 1.0.0-beta.6. A stack sample
  shows the .NET licensing SDK blocked on a unix socket. The only
  licensing endpoint on the machine was a 4 day old orphaned
  `Unity.Licensing.Client` owned by the running editors. Prime suspect,
  not yet confirmed by a restart. `unity run --command` is documented
  from `--help` only.
- `brew install --cask unity-cli` (1.0.0-beta.6): installs, but the
  binary hangs in dyld at its Caskroom path, with or without xattrs. A
  plain copy of the same file runs. Keep the curl install as primary.
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
