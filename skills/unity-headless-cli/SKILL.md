---
name: unity-headless-cli
description: Use when the user wants to "set up headless Unity", "drive Unity from the terminal", "add the unity CLI to this project", or run Unity in CI. Sets up the current Unity project to be driven headless from the terminal (no GUI, no MCP server), then uses that workflow. On invocation it adds com.unity.pipeline, writes docs/unity-cli-ref.md, and points CLAUDE.md at it, so this and future Claude sessions can create GameObjects, add components, edit assets, run tests, and evaluate live C# over SSH.
---

# Unity Headless CLI: setup and use

This skill has two jobs. First, **bootstrap** the current project so it can be driven headless. Second, **drive** it with `unity command` / `unity command eval`. Round trips are 200 to 600 ms with no recompile and no domain reload.

If the project already looks set up (CLAUDE.md points at `docs/unity-cli-ref.md` and the package is present), skip the bootstrap and go straight to "Drive it".

## Bootstrap (run once per project)

Do these in order. Confirm before anything that installs software or edits files. Each step is idempotent, so re-running the skill is safe.

### 1. Resolve the project root

Use the current git repo root (`git rev-parse --show-toplevel`), or the directory the user names. Confirm the path with the user before continuing. Call it `<root>`.

### 2. Ensure the Unity CLI is installed

```bash
unity --version
```

If that fails, tell the user you need to install the Unity CLI (beta) and ask to proceed. On yes, use one of:

```bash
brew install --cask unity-cli
curl -fsSL https://public-cdn.cloud.unity3d.com/hub/prod/cli/install.sh | UNITY_CLI_CHANNEL=beta bash
```

The script installs to `~/.unity/bin/unity`. Make sure that it is on `PATH` in non-login shells (SSH, CI).

The CLI is machine level, so never install it silently. If the user declines, stop and report what is missing.

### 3. Add the pipeline package to the project

```bash
unity pipeline install --project-path <root>
```

This adds `com.unity.pipeline` to `Packages/manifest.json`. If it is already present, this is a no-op. An old package version rejects newer CLI flags (`--detach`, `--query`, `--limit`) with "does not support". Run `unity pipeline upgrade --project-path <root>` and restart the editor.

### 4. Write the reference doc

Copy the bundled reference into the project so it lives with the code:

```bash
mkdir -p <root>/docs
cp "${CLAUDE_PLUGIN_ROOT}/skills/unity-headless-cli/references/unity-cli-ref.md" <root>/docs/unity-cli-ref.md
```

(`${CLAUDE_PLUGIN_ROOT}` is the installed plugin's directory. If it is not set, use this skill's own folder as the source.) If `docs/unity-cli-ref.md` already exists, overwrite it only after confirming, so you do not clobber local edits.

### 5. Wire up CLAUDE.md

Point the project's instructions at the reference so every future session knows about it, mirroring how a project links its own docs.

- If `<root>/CLAUDE.md` does not exist, create it with the section below.
- If it exists and does not already contain a "Headless Unity CLI" section, append the section below.
- If the section is already there, leave it alone.

Section to add:

```markdown
## Headless Unity CLI

This project can be driven headless from the terminal (no GUI, no MCP server) via the
Unity CLI + `com.unity.pipeline`. Commands: `unity command <tool> --project-path <p>`
and `unity command eval "<C#>" --project-path <p>`. Full reference, install, custom
commands, and gotchas: [docs/unity-cli-ref.md](docs/unity-cli-ref.md).
```

### 6. Report and hand off

Print a short summary of what changed (package added, `docs/unity-cli-ref.md` written, CLAUDE.md updated) and the one manual step that remains: launch a headless editor and leave it running.

```bash
# NO -quit; leave it running, then commands can reach it
Unity -batchmode -projectpath <root> -logFile editor.log
```

On a display less machine never launch the GUI editor: it hangs in AppKit startup. Always `-batchmode`.

## Drive it

Once a headless editor is running for the project. Set these once per shell:

```bash
export UNITY_PROJECT_PATH=<root>   # replaces --project-path on every call
export UNITY_NO_PAGER=1            # long output opens `less` and blocks an agent
export UNITY_NON_INTERACTIVE=1
```

```bash
# discover the tools this editor exposes
unity command --project-path <root>
unity command --query asset --limit 10 --project-path <root>   # filter the list

# built in commands
unity command create_gameobject --name Spawner --components Light --project-path <root>
unity command add_component --target Spawner --type Rigidbody --project-path <root>
unity command find_assets --name GameConfig --project-path <root>   # or --type <TypeName> / --label <label>

# live C# on the editor main thread
unity command eval "return Application.unityVersion;" --project-path <root>
unity command eval_file snippet.cs --project-path <root>

# tests and builds
unity command run_tests --project-path <root>

# long work: detach, then wait
unity command bake_lighting --detach --json --project-path <root>   # prints a jobId
unity job wait <jobId> --json
```

Exit codes: `0` ok, `2` usage error, `6` command failed (compile error in eval, no editor reachable, tests failed), `130` Ctrl+C, `143` SIGTERM.

Prefer `--project-path` or `UNITY_PROJECT_PATH`. `unity pipeline list` and `unity editors running` can show zero rows while batchmode editors answer commands; trust `unity command`, not the lists.

### Custom commands

Any static method tagged `[CliCommand]` in an Editor assembly becomes a tool automatically, no registration. Use `MainThreadRequired` for anything touching engine state; `RuntimeOnly` for dev-Player-only commands.

### Many projects

The same terminal drives any project. Loop:

```bash
for P in game-alpha puzzle-proto runner-3d; do
  unity command create_gameobject --name Spawner --project-path "$P"
done
```

### Without a running editor (CI)

`unity run <project> --command <name> -- <args>` starts a batchmode editor, runs one registered command, and exits. `unity test <project> --report-format junit --coverage` and `unity build <project> --profile <name>` (Unity 6 build profiles, no `--execute-method` needed) cover the rest. See the reference for details.

## Gotchas

- The CLI is beta and the package is experimental (`-exp`). Expect churn between versions.
- Commands that go through the auth or licensing layer can hang with no output: `unity doctor`, `unity auth status`, `unity license status`, `unity run`, `unity projects create`. `--non-interactive` hangs too. Seen on a headless Mac with Unity Hub running; stale Hub keychain items caused the same symptom before. `unity command`, `unity job`, `unity editors list` are not affected. Always wrap these commands in a timeout in scripts.
- `eval` runs arbitrary C# and is gated behind the pipeline server's localhost bearer token by design. Treat it with the same care as running project code.

Full detail lives in `docs/unity-cli-ref.md` after bootstrap, or in `references/unity-cli-ref.md` in this skill.
