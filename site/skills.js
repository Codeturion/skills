const REPO = "https://github.com/Codeturion/skills";
const SKILLS = [
  {
    id: "headless-cli", name: "unity-headless-cli", area: "core", status: "verified",
    blurb: "Drive a Unity project over SSH: no GUI editor, no MCP server",
    verified: "2026-07 · 6000.3", repo: REPO + "/tree/main/skills/unity-headless-cli",
    detail: "Gives you a unity command that creates GameObjects, edits assets and runs test suites, plus eval for throwing live C# at the editor: 200 to 600 ms round trip, no domain reload. The part worth reading is keeping the editor alive between calls without deadlocking on the compile pipeline.",
    sections: "bootstrap · unity <cmd> · eval / eval_file · run_tests · custom [CliCommand] tools",
    requires: "nothing, start here", notes: "Verified on macOS with Unity 6000.3. Windows is untested.",
    slug: "unity-headless-cli",
  },
  {
    id: "addressables", name: "unity-addressables", area: "assets", status: "verified",
    blurb: "Groups, leak-safe loading, CI content builds, remote content off a static host",
    verified: "2026-07 · 6000.3", repo: REPO + "/tree/main/skills/unity-addressables",
    detail: "Setup through shipping: groups and labels, loading that releases its handles, content builds in CI, and remote content off a plain static host so you can push an update without a store release. Scan recipes for dead entries and duplicate addresses live in test-cases, next to the 2.x→3.x upgrade note you want before you upgrade.",
    sections: "setup · groups-and-labels · runtime-loading · build-and-ci · remote-content · test-cases",
    requires: "unity-headless-cli (for the scan recipes)", notes: "Covers Addressables 2.9 and 3.1.",
    slug: "unity-addressables",
  },
  { id: "ios-cicd", name: "unity-ios-cicd", area: "ci", status: "planned", blurb: "Self-hosted Actions runner → Fastlane → TestFlight", verified: "not yet", repo: REPO, detail: "Self-hosted GitHub Actions runner on a Mac, Fastlane signing, TestFlight upload: the whole path from commit to a build on your phone.", sections: "not written yet", requires: "unity-headless-cli", notes: "In the pipeline.", slug: "unity-ios-cicd" },
  { id: "playmode", name: "unity-playmode-automation", area: "testing", status: "planned", blurb: "Headless play-mode smoke tests with real input injection", verified: "not yet", repo: REPO, detail: "Runs play mode in batchmode and drives it with synthesized input for smoke tests that exercise the real game loop.", sections: "not written yet", requires: "unity-headless-cli", notes: "In the pipeline.", slug: "unity-playmode-automation" },
  { id: "build-pipeline", name: "unity-build-pipeline", area: "build", status: "planned", blurb: "Reproducible player builds from the CLI, per-platform", verified: "not yet", repo: REPO, detail: "The goal is one command that produces a byte-identical player given the same commit and editor version.", sections: "not written yet", requires: "unity-headless-cli", notes: "On the roadmap.", slug: "unity-build-pipeline" },
  { id: "profiling", name: "unity-profiling", area: "perf", status: "planned", blurb: "Capture and diff profiler traces without opening the editor", verified: "not yet", repo: REPO, detail: "Capture .raw traces in CI and diff frame timings between commits.", sections: "not written yet", requires: "unity-headless-cli", notes: "On the roadmap.", slug: "unity-profiling" },
  { id: "asset-hygiene", name: "unity-asset-hygiene", area: "assets", status: "planned", blurb: "Find unreferenced assets, bad import settings, texture bloat", verified: "not yet", repo: REPO, detail: "Mostly a set of eval scripts already run by hand; needs to be written up with real numbers.", sections: "not written yet", requires: "unity-headless-cli", notes: "On the roadmap.", slug: "unity-asset-hygiene" },
  { id: "upm-registry", name: "unity-upm-registry", area: "core", status: "planned", blurb: "Private UPM registry and package publishing from CI", verified: "not yet", repo: REPO, detail: "Covers hosting a scoped registry and publishing packages on tag.", sections: "not written yet", requires: "unity-headless-cli", notes: "On the roadmap.", slug: "unity-upm-registry" },
];

const AREAS = ["all", "core", "assets", "build", "ci", "testing", "perf"];
const STATUSES = ["all", "verified", "planned"];
const RANK = { verified: 0, draft: 1, planned: 2 };
