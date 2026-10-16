<!-- atlas-agent-provenance/v1
schema: atlas-agent-provenance/v1
change_id: 296c873e-dc69-4d2d-ae54-5bf532b42554
timestamp: 2026-10-16T04:05:48.288898Z
file: AGENTS.md
change_kind: create
base_commit: 335144c992b498d6f15810adb61f25c94b59bea4
hunks: -0,0:+1,36
coder_runtime: codex-desktop
coder_model: Codex (GPT-6)
coder_model_id: not_exposed
coder_reasoning: not_exposed
coder_max_mode: not_exposed
coder_mode: agent
coder_context_window: not_exposed
plan_id: atlas-dev-pr-routing
plan_path: dev-workflow/PR-TARGET-POLICY.md
plan_revision: 7ad024450572908b34c55d77c7e1a7f07be592c3dd399672fd5e9942d1627192
planner_model: Codex (GPT-6)
planner_model_id: not_exposed
planner_reasoning: not_exposed
planner_max_mode: not_exposed
planner_context_window: not_exposed
fixes_change_ids: none
-->

# Pull request routing — mandatory for every coding agent

- All ordinary feature, fix, maintenance, documentation, and dependency PRs target **`dev`**. Always pass `--base dev` when creating a PR.
- Production promotion is a deliberate **same-repository `dev` → `main` PR**, opened only when Jeremy explicitly says the release is ready. No feature/release branches or fork branches may target `main`.
- Do not create ordinary PRs against `main`, `develop`, release branches, or other feature branches. Do not automatically promote, auto-merge, deploy, or push directly to `dev`/`main`.
- Use a feature branch from current `dev`. Preserve unrelated work. Do not retarget existing PRs without direction.
- Run `node scripts/install-pr-target-hook.cjs` once per clone. Run `node --test scripts/pr-target-guard.test.cjs` after changing routing enforcement. Never bypass a failing routing hook or check.
- Local hooks cannot prevent a PR being opened in a browser or API. Do not claim server blocking until the trusted workflow is active and a required server rule is verified.

See [the PR routing policy](dev-workflow/PR-TARGET-POLICY.md) for setup, tests, deployment prerequisites, and enforcement limits. Existing repository provenance requirements still apply to every edit; do not bypass them.
