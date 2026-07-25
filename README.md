# Skills

[![License: MIT](https://img.shields.io/github/license/Codeturion/skills)](LICENSE)
[![Unity](https://img.shields.io/badge/Unity-6000.x-000000?logo=unity)](https://unity.com)
[![Site](https://img.shields.io/badge/browse-skills.fuatcankoseoglu.com-3574F0)](https://skills.fuatcankoseoglu.com)

**Browse and install from the website: [skills.fuatcankoseoglu.com](https://skills.fuatcankoseoglu.com)**

Unity agent skills ([skills.sh](https://skills.sh) standard): production workflows, terminal-first and headless.

The bar for everything in this repo: **nothing ships unverified**. Every command, snippet, and behavior claim is executed on a real Unity editor before it is written down, and each skill carries its verification record in its `references/test-cases.md`.

## Install

```bash
# any agent (Claude Code, Cursor, Codex, ...)
npx skills add Codeturion/skills

# or one skill only
npx skills add Codeturion/skills --skill unity-addressables
```

```text
# Claude Code plugin flow
/plugin marketplace add Codeturion/skills
/plugin install unity-addressables@skills
/plugin install unity-headless-cli@skills
/plugin install unity-ios-cicd@skills
```

Or copy a folder from `skills/` into your project's `.claude/skills/`.

## Skills

| Skill | What it does | Verified on |
|---|---|---|
| [unity-addressables](skills/unity-addressables/) | Addressables end to end: setup, groups and labels, leak-safe runtime loading, content builds in CI, remote content with updates from any static host. Includes the scan recipes and the traps found only by running it. | Unity 6000.3, Addressables 2.9.0 and 3.1.0, iOS content build |
| [unity-headless-cli](skills/unity-headless-cli/) | Drive a Unity project headless from the terminal: no GUI editor, no MCP server. Create GameObjects, edit assets, run tests, evaluate live C#, 200 to 600 ms round trips. | Unity 6000.x, com.unity.pipeline |
| [unity-ios-cicd](skills/unity-ios-cicd/) | Turn a Mac into an iOS build machine: self-hosted GitHub Actions runner, Unity batchmode export, fastlane match signing in a dedicated CI keychain, TestFlight upload. Interviews you first and walks every secret click by click. Covers CocoaPods projects (Firebase, ad SDKs) via the verified EDM4U path. | Unity 6000.3, live TestFlight pipeline on a headless Mac mini |

Each skill has a shareable page: [unity-addressables](https://skills.fuatcankoseoglu.com/#unity-addressables), [unity-headless-cli](https://skills.fuatcankoseoglu.com/#unity-headless-cli), [unity-ios-cicd](https://skills.fuatcankoseoglu.com/#unity-ios-cicd).

On the bench: `unity-playmode-automation` (headless smoke tests). The full roadmap is on the site.

## License

MIT
