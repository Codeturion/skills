# Unity headless CLI reference

Drive a running Unity Editor from the terminal over SSH. No window, no bridge process, no MCP protocol. `unity command` and `unity command script eval` reach anything your project code can reach, with 200 to 600 ms round trips.

Distilled from the official Unity CLI reference: https://docs.unity.com/en-us/unity-cli/unity-cli-reference

## The stack

| Layer | What it does |
|---|---|
| Unity CLI | Standalone `unity` binary (beta). Manages editors, talks to the pipeline. |
| com.unity.pipeline | Experimental package. Local HTTP API inside the Editor, 127.0.0.1 only, bearer token auth. |
| `unity command <group> <name>` | Invoke registered commands (`script eval` runs live C# via Roslyn on the Editor main thread). |

## Install

```bash
brew install --cask unity-cli      # macOS
# or
curl -fsSL https://public-cdn.cloud.unity3d.com/hub/prod/cli/install.sh | UNITY_CLI_CHANNEL=beta bash
unity --version
unity pipeline install --project-path <project>
unity pipeline install --package-version 0.9.0-exp.1 --project-path <project>   # pin a version
unity pipeline upgrade --project-path <project>   # later: move com.unity.pipeline forward
```

This reference needs `com.unity.pipeline` 0.9.0-exp.1 or newer. See "Package 0.9 and newer" below.

The script installs to `~/.unity/bin/unity` and adds it to `PATH` through `~/.unity/env` in `.zshrc`. Non-login shells (SSH commands, CI steps) do not load `.zshrc`, so export `PATH=$HOME/.unity/bin:$PATH` there.

Agent and CI shell setup:

```bash
export UNITY_PROJECT_PATH=<project>   # replaces --project-path on every call
export UNITY_NO_PAGER=1               # long output opens `less` and blocks
export UNITY_NON_INTERACTIVE=1
export UNITY_NO_CONSENT_PROMPT=1 UNITY_NO_CRASH_REPORT=1 UNITY_NO_UPDATE_CHECK=1
```

## Launch a headless Editor

```bash
# NO -quit, the editor must stay alive to accept commands
Unity -batchmode -projectpath <project> -logFile <log>
```

On a display less machine, the GUI editor hangs in AppKit's finish launching handshake. Always use `-batchmode`. First open of a cold Library takes minutes, so wait until `unity command` answers.

## Drive it

```bash
unity command --project-path <project>                    # list tools
unity command --query asset --tag assets --limit 10       # filter the list
unity command script --project-path <project>             # list one group
unity command gameobject create --name Spawner --project-path <project>
unity command component add --target Spawner --type Rigidbody --project-path <project>
unity command asset find --name GameConfig --project-path <project>   # or --type <TypeName> / --label <label>
unity command script eval "return Application.unityVersion;" --project-path <project>
unity command script eval_file snippet.cs --project-path <project>
unity command test run --project-path <project>
```

`script eval` compiles with Roslyn and runs on the Editor main thread. Engine API, `EditorApplication`, and your own project scripts are all in reach. No recompile, no domain reload.

Prefer `--project-path` or `UNITY_PROJECT_PATH`. `unity pipeline list` and `unity editors running` can both show zero rows while batchmode editors answer commands; trust `unity command`, not the lists.

### Package 0.9 and newer

- Every command has a group. Write `unity command <group> <name>`, for example `unity command script eval`. Old names that no longer exist (`create_gameobject`, `run_tests`) are refused, and the error names the new command. A bare name that still matches exactly one command (`eval`) runs, but a new command can make it ambiguous, so always write the group.
- The rename table (170 names) ships in the package as `Editor/ObsoleteCommandNames.json`. With Unity CLI 1.0.0-beta.14 or newer, `unity command --obsolete-command-names` prints it. Older CLIs ignore the flag and print the plain list. The server also serves it at `/api/commands?detail=obsolete_names`.
- A CLI older than beta.14 lists bare names with no group in `unity command`. `unity command <group>` lists one group with full names.
- `--verbose` and `--omit-nulls` work on every command. `--timeout <seconds>` is per command.
- The Editor and Runtime servers answer only on `127.0.0.1`. Use the IP, not `localhost`. A request with another Host header is refused.
- "Code Reload" is now "Method Reload": the `script.methodreload` group, and the attributes and namespaces carry the new name.
- New in 0.9.0: `build create_profile`, `build list_platforms`, `build set_profile`, `editor.playmode set_run_in_background --enable true`. Boolean switches on the editor commands are named `--enable`, for example `editor set_auto_tick --enable true`.

### Detached jobs (long bakes, builds)

```bash
unity command lighting bake --detach --json   # returns {"jobId": "...", "state": "queued"}
unity job status <jobId>
unity job wait <jobId> --json                 # blocks, then prints the command result
unity job cancel <jobId>
```

### Many projects, one terminal

```bash
for P in game-alpha puzzle-proto runner-3d; do
  unity command gameobject create --name Spawner --project-path "$P"
done
```

## Custom commands: any static method becomes a tool

No registration step. Tag a static method and it shows up in `unity command`:

```csharp
using UnityEngine;
using Unity.Pipeline.Commands;   // assembly: Unity.Pipeline.Attributes

public static class MyPipelineCommands
{
    [CliCommand("mytool", "validate_content", "Validate all content definitions", MainThreadRequired = false)]
    public static int ValidateContent(
        [CliArg("strict", "Fail on warnings")] bool strict = false)
    {
        return strict ? 1 : 0; // non-zero fails CI
    }

    [CliCommand("mytool", "spawn_marker", "Create a marker GameObject")]
    public static string SpawnMarker([CliArg("name", "Name")] string name = "Marker")
    {
        var go = new GameObject(name);
        return $"created {name}";
    }
}
```

```bash
unity command mytool validate_content --strict true
unity command mytool spawn_marker --name Waypoint
```

The first argument is the group, the second the name. The two-argument form `[CliCommand(name, description)]` is deprecated in 0.9.0: it puts the command in the `global` group, and it runs by its bare name. If the code lives in an assembly definition, reference `Unity.Pipeline.Attributes`. Scripts outside an asmdef need no reference.

Attribute properties: `MainThreadRequired` defaults to true, set it to false only for pure C# with no engine calls. For dev-Player-only commands set `Tags = new[] { "runtime" }` (`RuntimeOnly` was removed in 0.9.0). Run them with `unity command --runtime <player> <group> <name>`, dev/QA only, never production.

## Automation contract

- `--format json|tsv|ndjson` on any command, `--json` is shorthand. Piped stdout defaults to TSV, errors go to stderr. With `ndjson`, a failure ends in a `{"type":"result","success":false,...}` frame.
- Exit codes: `0` ok, `1` error, `2` usage error (bad flag or value), `6` command failed (eval compile error, no editor reachable, test failures, auth or cloud failure), `130` Ctrl+C, `143` SIGTERM.
- `unity run <project> --command <name> -- <args>`: start a batchmode editor, run one registered `[CliCommand]`, exit. Use `--timeout <seconds>`. No long-lived editor needed.
- `unity test <project>`: EditMode/PlayMode. `--report-format nunit|junit|nunit,junit`, `--junit-output <path>`, `--coverage` (needs the Code Coverage package), `--coverage-output <dir>`.
- `unity build <project>`: `--execute-method` is optional now. On Unity 6, `--profile <path-or-name>` builds a Build Profile. Desktop targets build with only `--target` and `--output-path`.
- `unity open`: resolves the editor version from `ProjectVersion.txt`.
- CLI logs: `~/Library/Application Support/UnityHub/logs/cli-log.json`.

## Built in command surface

Everything below is a `unity command <group> <name>`. The groups and names come from the 0.9.0-exp.1 package; `unity command <group>` lists a group live.

| Group | Commands |
|---|---|
| asset | create, import, move, copy, rename, delete, find, create_folder, read_text, write_text, get_import_settings, set_import_settings |
| scene | create, open, save, set_active, get_hierarchy, add_to_build, remove_from_build |
| gameobject | create, create_many, find, delete, rename, set_active, set_parent, set_transform, get_selection |
| component | add, get_fields, set_field, get_properties, set_properties |
| prefab | create, create_variant, instantiate, apply_overrides, save_contents |
| script | create, attach, eval, eval_file, run, recompile, recompile_status |
| script.methodreload | reload, reload_editor, reload_player, status, cleanup |
| material | list_shaders, set_properties |
| lighting, navmesh, occlusion | bake, bake_status, cancel_bake, clear_bake, get_settings, set_settings |
| capture | screenshot, game_view, editor_element, runtime_element |
| build, build.target | run, status, list_platforms, list_profiles, create_profile, set_profile, get_settings, set_settings; target list, switch, switch_status |
| test | list, run, status, cancel |
| settings.* | audio, graphics, input, physics, player, quality, tags_layers, time (get, set) |
| package | list, search, add, remove, resolve, status |
| editor | status, focus, invoke_menu, save_all, search, set_auto_tick |
| editor.playmode | start, stop, pause, set_run_in_background |
| console | get, status, clear, write |
| job | batch, wait, wait_status, wait_cancel |
| animation.animator, animation.clip, animation.timeline | create_controller, add_layer, add_parameter, add_state, add_transition; create, set_curve, remove_curve; create, add_track, add_clip |
| runtime (dev Player) | status, quit, set_time_scale, set_target_frame_rate, simulate_key, simulate_pointer |

## Honest caveats

- Everything here is experimental. The CLI is beta, the package is `-exp`. Expect churn between versions.
- Commands that go through the auth or licensing layer can hang with no output, no log line, and no prompt: `unity doctor`, `unity auth status`, `unity license status`, `unity cloud status`, `unity run`, `unity projects create`. `--non-interactive` does not help. Seen on a headless Mac with Unity Hub running. Stale Hub keychain items caused the same symptom before (an invisible GUI prompt), so check those first. `unity command`, `unity job`, `unity editors list`, `unity projects list` are not affected. Wrap the hanging family in a timeout (`perl -e 'alarm 60; exec @ARGV' unity doctor`).
- An old `com.unity.pipeline` rejects newer CLI flags with "does not support ...". Run `unity pipeline upgrade` and restart the editor. A package older than 0.9.0 still uses the flat names, so this reference does not match it.
- A compile error in a project script stops a batchmode editor at start-up. If `unity command` never answers, grep the editor log for `error CS`.
- Unity ships its own agent skill (`unity skill install <client>`) and an MCP server (`unity mcp`). This reference is the no-MCP path: one binary, one HTTP hop, works over SSH.
- The pipeline HTTP server binds `127.0.0.1` with a bearer token, and `eval` is gated behind that token by design. Good, since `eval` runs arbitrary C#.

## Docs

- Unity CLI reference: https://docs.unity.com/en-us/unity-cli/unity-cli-reference
- Release notes: https://docs.unity.com/en-us/unity-cli/release-notes
- Using the Unity CLI: https://docs.unity.com/en-us/unity-cli/use-unity-cli
- Pipeline package: https://docs.unity3d.com/Packages/com.unity.pipeline@0.9
