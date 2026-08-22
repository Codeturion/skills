# Unity headless CLI reference

Drive a running Unity Editor from the terminal over SSH. No window, no bridge process, no MCP protocol. `unity command` and `unity command eval` reach anything your project code can reach, with 200 to 600 ms round trips.

Distilled from the official Unity CLI reference: https://docs.unity.com/en-us/unity-cli/unity-cli-reference

## The stack

| Layer | What it does |
|---|---|
| Unity CLI | Standalone `unity` binary (beta). Manages editors, talks to the pipeline. |
| com.unity.pipeline | Experimental package. Local HTTP API inside the Editor, localhost only, bearer token auth. |
| `unity command` / `eval` | Invoke registered commands, or run live C# via Roslyn on the Editor main thread. |

## Install

```bash
brew install --cask unity-cli      # macOS
# or
curl -fsSL https://public-cdn.cloud.unity3d.com/hub/prod/cli/install.sh | UNITY_CLI_CHANNEL=beta bash
unity --version
unity pipeline install --project-path <project>
unity pipeline upgrade --project-path <project>   # later: move com.unity.pipeline forward
```

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
unity command --query asset --tag assets --limit 10       # filter the list (needs com.unity.pipeline 0.5+)
unity command create_gameobject --name Spawner --components Light --project-path <project>
unity command add_component --target Spawner --type Rigidbody --project-path <project>
unity command find_assets --name GameConfig --project-path <project>   # or --type <TypeName> / --label <label>
unity command eval "return Application.unityVersion;" --project-path <project>
unity command eval_file snippet.cs --project-path <project>
unity command run_tests --project-path <project>
```

`eval` compiles with Roslyn and runs on the Editor main thread. Engine API, `EditorApplication`, and your own project scripts are all in reach. No recompile, no domain reload.

Prefer `--project-path` or `UNITY_PROJECT_PATH`. `unity pipeline list` and `unity editors running` can both show zero rows while batchmode editors answer commands; trust `unity command`, not the lists.

### Detached jobs (long bakes, builds)

Needs com.unity.pipeline 0.5.0-exp.1 or newer.

```bash
unity command bake_lighting --detach --json   # returns {"jobId": "...", "state": "queued"}
unity job status <jobId>
unity job wait <jobId> --json                 # blocks, then prints the command result
unity job cancel <jobId>
```

### Many projects, one terminal

```bash
for P in game-alpha puzzle-proto runner-3d; do
  unity command create_gameobject --name Spawner --components Light --project-path "$P"
done
```

## Custom commands: any static method becomes a tool

No registration step. Tag a static method and it shows up in `unity command`:

```csharp
using UnityEngine;
using Unity.Pipeline.Commands;

public static class MyPipelineCommands
{
    [CliCommand("validate_content", "Validate all content definitions")]
    public static int ValidateContent(
        [CliArg("strict", "Fail on warnings")] bool strict = false)
    {
        return strict ? 1 : 0; // non-zero fails CI
    }

    [CliCommand("spawn_marker", "Create a marker GameObject")]
    [MainThreadRequired]
    public static string SpawnMarker([CliArg("name", "Name")] string name = "Marker")
    {
        var go = new GameObject(name);
        return $"created {name}";
    }
}
```

```bash
unity command validate_content --strict true
unity command spawn_marker --name Waypoint
```

Attributes: `MainThreadRequired` for anything touching engine state; `RuntimeOnly` for dev-Player-only commands (`unity command --runtime <player>`, dev/QA only, never production).

## Automation contract

- `--format json|tsv|ndjson` on any command, `--json` is shorthand. Piped stdout defaults to TSV, errors go to stderr. With `ndjson`, a failure ends in a `{"type":"result","success":false,...}` frame.
- Exit codes: `0` ok, `1` error, `2` usage error (bad flag or value), `6` command failed (eval compile error, no editor reachable, test failures, auth or cloud failure), `130` Ctrl+C, `143` SIGTERM.
- `unity run <project> --command <name> -- <args>`: start a batchmode editor, run one registered `[CliCommand]`, exit. Use `--timeout <seconds>`. No long-lived editor needed.
- `unity test <project>`: EditMode/PlayMode. `--report-format nunit|junit|nunit,junit`, `--junit-output <path>`, `--coverage` (needs the Code Coverage package), `--coverage-output <dir>`.
- `unity build <project>`: `--execute-method` is optional now. On Unity 6, `--profile <path-or-name>` builds a Build Profile. Desktop targets build with only `--target` and `--output-path`.
- `unity open`: resolves the editor version from `ProjectVersion.txt`.
- CLI logs: `~/Library/Application Support/UnityHub/logs/cli-log.json`.

## Built in command surface

Everything below is a `unity command <name>`:

| Category | Commands |
|---|---|
| Assets & files | create / import / move / copy / rename / delete asset, find_assets, import settings, read / write text file, create_folder |
| Scenes | create / open / save scene, save_all, hierarchy, active scene, build list add / remove |
| GameObjects & components | create / find / delete, transform, parent, tag, layer, add / remove component, get / set component properties |
| Prefabs | create, instantiate, variants, apply / revert overrides, unpack |
| Scripts | create_script, attach_script, get / set serialized fields |
| Materials & shaders | get / set material properties, list shaders, shader properties |
| Baking | lighting, navmesh, occlusion culling (async plus poll status) |
| Capture | capture_game_view, capture_scene_view, capture_editor_element |
| Build & compilation | build, switch_build_target, recompile, list / run tests, test_status |
| Project settings | audio, graphics, input, physics, player, quality, tags / layers, time |
| Package manager | list, search, add, remove, resolve, status |
| Editor lifecycle | play / stop / pause, status, menu, screenshot, console logs, performance stats |
| Runtime (dev Player) | status, timescale, simulate key / pointer, live eval plus hot reload |

## Honest caveats

- Everything here is experimental. The CLI is beta, the package is `-exp`. Expect churn between versions.
- Commands that go through the auth or licensing layer can hang with no output, no log line, and no prompt: `unity doctor`, `unity auth status`, `unity license status`, `unity cloud status`, `unity run`, `unity projects create`. `--non-interactive` does not help. Seen on a headless Mac with Unity Hub running. Stale Hub keychain items caused the same symptom before (an invisible GUI prompt), so check those first. `unity command`, `unity job`, `unity editors list`, `unity projects list` are not affected. Wrap the hanging family in a timeout (`perl -e 'alarm 60; exec @ARGV' unity doctor`).
- An old `com.unity.pipeline` rejects newer CLI flags with "does not support ...". Run `unity pipeline upgrade` and restart the editor.
- Unity ships its own agent skill (`unity skill install <client>`) and an MCP server (`unity mcp`). This reference is the no-MCP path: one binary, one HTTP hop, works over SSH.
- The pipeline HTTP server binds localhost with a bearer token, and `eval` is gated behind that token by design. Good, since `eval` runs arbitrary C#.

## Docs

- Unity CLI reference: https://docs.unity.com/en-us/unity-cli/unity-cli-reference
- Release notes: https://docs.unity.com/en-us/unity-cli/release-notes
- Using the Unity CLI: https://docs.unity.com/en-us/unity-cli/use-unity-cli
- Pipeline package: https://docs.unity3d.com/Packages/com.unity.pipeline@0.5
