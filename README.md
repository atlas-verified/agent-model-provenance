# Agent Model Provenance

Cursor plugin that forces every agent edit to leave a **machine-readable byline**:

- which **coding model** wrote the change
- which **planner model** produced the plan (when different)
- exact **hunks** + base commit
- optional link to the prior `change_id` a bug fix is correcting

Schema: `atlas-agent-provenance/v1`

Built from production use on a multi-model monorepo. Rules alone get ignored. This pairs an always-on rule with **Cursor hooks** (including a stop gate) plus optional pre-commit/CI scripts.

## Install

### A) Cursor Marketplace (after approval)

1. Open Cursor → **Marketplace** / **Customize → Plugins**
2. Install **Agent Model Provenance**
3. Open a trusted workspace and run an agent edit — hooks should fire

### B) From this repo (local / review)

```bash
git clone https://github.com/atlas-verified/agent-model-provenance.git
```

In Cursor, add the plugin from the local folder (Customize → Plugins → add local / path, depending on your Cursor version), **or** vendor the pieces into your project:

```bash
# into your application repo
mkdir -p .cursor/hooks scripts/lib .cursor/rules
cp hooks/hooks.json .cursor/hooks.json   # or merge into existing
cp -R scripts/* scripts/
cp rules/agent-edit-provenance.mdc .cursor/rules/
cp githooks/pre-commit .githooks/pre-commit   # optional
git config core.hooksPath .githooks           # optional
```

Project-level `.cursor/hooks.json` is the most reliable path today (marketplace hooks are IDE-first; CLI support for plugin hooks has had gaps).

## What you get

| Piece | Role |
|---|---|
| `rules/agent-edit-provenance.mdc` | Always-on reminder |
| `hooks/hooks.json` | `afterFileEdit` track · `postToolUse` remind · `stop` force one fix-up turn |
| `scripts/check-agent-provenance.cjs` | Pre-commit / CI gate |
| `scripts/provenance-hunks.cjs` | Suggest hunk coordinates from git diff |
| `githooks/pre-commit` | Optional commit blocker |

### Stop gate

When the agent tries to finish with missing bylines, the stop hook injects:

```text
PROVENANCE GATE: You edited files without valid atlas-agent-provenance/v1 attribution.
Do not start new feature work. Fix provenance on every file below, then stop.
```

`loop_limit: 1` so it cannot thrash forever.

## Provenance format

### Commentable files (`.ts`, `.tsx`, `.md`, `.py`, `.sql`, …)

Newest block only at the topmost legal comment location. Next agent edit **replaces** it. Git history keeps prior records.

```ts
/* atlas-agent-provenance/v1
 * schema: atlas-agent-provenance/v1
 * change_id: …
 * timestamp: 2026-08-12T00:00:00Z
 * file: path/to/file.ts
 * change_kind: modify
 * base_commit: abc123…
 * hunks: -12,3:+12,8
 * coder_runtime: cursor-agent
 * coder_model: Cursor Grok 4.5
 * coder_model_id: not_exposed
 * coder_reasoning: not_exposed
 * coder_max_mode: not_exposed
 * coder_mode: agent
 * coder_context_window: not_exposed
 * plan_id: none
 * plan_path: none
 * plan_revision: none
 * planner_model: none
 * planner_model_id: none
 * planner_reasoning: none
 * planner_max_mode: none
 * planner_context_window: none
 * fixes_change_ids: none
 */
```

See `templates/header.example.ts`.

### Non-commentable files (JSON, lockfiles, binaries)

Append one JSON object per line to:

```text
.cursor/agent-provenance.jsonl
```

Sidecar is **not** allowed for commentable sources. See `templates/agent-provenance.jsonl.example`.

### Hard rules

- `hunks: pending` is invalid
- Never invent model ids / Max Mode / context window — use `not_exposed` or `unknown`
- Human-only bypass: `SKIP_AGENT_PROVENANCE=1` (agents must not use it)

## Wire pre-commit + CI in your app repo

```bash
# pre-commit
cp githooks/pre-commit .githooks/pre-commit
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks

# local check
node scripts/check-agent-provenance.cjs --staged

# CI (PR diff vs base)
node scripts/check-agent-provenance.cjs --ci
# optional: BASE_REF=origin/main
```

Example GitHub Actions job:

```yaml
agent-provenance:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - uses: actions/setup-node@v4
      with:
        node-version: "20"
    - name: Check agent provenance
      env:
        BASE_REF: ${{ github.base_ref }}
      run: node scripts/check-agent-provenance.cjs --ci
```

## Why this exists

Multi-model teams accumulate anecdotes ("that model half-finishes work") without hard joins from **model → diff → later bug fix**.

This plugin does not rank models by itself. It makes ranking *possible*.

## Publish to Cursor Marketplace

1. Keep this repo **public**
2. Confirm `node` can run the hook scripts locally in a test workspace
3. Open [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish)
4. Submit `https://github.com/atlas-verified/agent-model-provenance`
5. Cursor team reviews (checklist in their [plugins docs](https://cursor.com/docs/reference/plugins))

Alternate contact noted by Cursor's plugin template: Slack or `kniparko@anysphere.com`.

## License

MIT © Jeremy Crane
