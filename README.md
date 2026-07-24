# Codeturion Skills

Unity agent skills ([skills.sh](https://skills.sh) standard): production workflows, terminal-first and headless. The bar for everything in this repo: **nothing ships unverified**. Every command, snippet, and behavior claim is executed on a real Unity editor before it is written down, and each skill carries its verification record in `references/test-cases.md`.

## Install

```bash
# any agent (Claude Code, Cursor, Codex, ...)
npx skills add Codeturion/skills
```

```text
# Claude Code plugin flow
/plugin marketplace add Codeturion/skills
/plugin install unity-addressables@skills
/plugin install unity-headless-cli@skills
```

Or copy a folder from `skills/` into your project's `.claude/skills/`.

## Skills

| Skill | What it does | Verified on |
|---|---|---|
| [unity-addressables](skills/unity-addressables/) | Addressables end to end: setup, groups and labels, leak-safe runtime loading, content builds in CI, remote content with updates from any static host. Includes the scan recipes and the traps found only by running it. | Unity 6000.3, Addressables 2.9.0 and 3.1.0, iOS content build |
| [unity-headless-cli](skills/unity-headless-cli/) | Drive a Unity project headless from the terminal: no GUI editor, no MCP server. Create GameObjects, edit assets, run tests, evaluate live C#, 200 to 600 ms round trips. | Unity 6000.x, com.unity.pipeline |

On the bench: `unity-ios-cicd` (GitHub Actions self-hosted, Fastlane, TestFlight) and `unity-playmode-automation` (headless smoke tests).

## License

MIT
