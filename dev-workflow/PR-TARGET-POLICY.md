<!-- atlas-agent-provenance/v1
schema: atlas-agent-provenance/v1
change_id: 43cbda2b-bdc0-47d2-bbf2-018048472948
timestamp: 2026-10-16T04:05:48.289672Z
file: dev-workflow/PR-TARGET-POLICY.md
change_kind: create
base_commit: 335144c992b498d6f15810adb61f25c94b59bea4
hunks: -0,0:+1,72
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

# Atlas pull request routing

Ordinary work targets `dev`. Production promotion is only an explicitly authorized, same-repository `dev` → `main` pull request. A successful check is eligibility to review, never authorization to release.

## Trusted server check

`.github/workflows/pr-target-guard.yml` produces **Atlas PR Target**. It accepts all valid PRs to `dev`, including fork contributions. It permits `main` only when the head is exactly `dev` and both repository ID and full name match the base repository. All other bases fail. Missing or inconsistent metadata fails closed.

The workflow uses `pull_request_target` with no path or branch filters and handles `opened`, `reopened`, `synchronize`, `edited` (including retargeting), `ready_for_review`, and `converted_to_draft`. Concurrency is scoped per PR and cancels obsolete runs. The job is unconditional so a forbidden target cannot pass as a skipped job.

There are no token permissions, actions, repository checkout, package installs, secrets, caches, environments, or execution of PR code. The check reads the JSON event file; it does not interpolate PR-controlled strings into shell code. Its inline policy is asserted byte-for-byte against the local pure function in the tests. A separate, read-only `pull_request` workflow tests proposed guard edits without secrets or persisted checkout credentials. It is not the trusted enforcement check.

## Local preflight

Requires Node 20+ and an authenticated GitHub CLI.

```sh
node scripts/install-pr-target-hook.cjs
node --test scripts/pr-target-guard.test.cjs
gh pr create --draft --base dev
```

The installer preserves the existing pre-commit hook and refuses to overwrite a different `core.hooksPath`; integrate the pre-push hook manually if a clone uses another hook manager. It sets this branch's GitHub CLI merge base to `dev`; continue passing `--base dev` explicitly on every branch.

The pre-push hook blocks direct pushes and deletions of `dev`/`main`, including refspecs that rename a feature branch to either destination. Before other branch updates it checks every open PR from the destination branch, across all API pages, and rejects invalid routing. Authentication, connectivity, malformed responses, and unknown remotes fail closed. Tags and deletion of ordinary feature branches do not require a PR. Existing provenance checks remain enabled.

A first feature push has no PR target yet. Git has no pre-PR hook, so this cannot intercept PR creation or later retargeting through GitHub's web UI, API, or another machine. Local hooks are defense in depth, not mandatory server enforcement. Installation applies only to that clone and is not automatically distributed by Git.

## Activating mandatory server enforcement

This PR prepares the guard; it does not change branch protection, rulesets, default branches, access permissions, billing, or repository visibility.

1. Review and merge this implementation into `dev` through the normal process.
2. Make the trusted workflow available on the repository's **default branch** before expecting `pull_request_target` runs. GitHub now sources these workflows from the default branch regardless of PR base. While the default is `main`, this requires the next deliberate `dev` → `main` promotion; do not release solely to bootstrap this check. An owner-approved default-branch change to `dev` is an alternative, but must be reviewed separately.
3. Run a PR event and verify the actual **Atlas PR Target** check exists and behaves correctly.
4. After owner approval and where the GitHub plan permits it, create an **active** branch ruleset covering `refs/heads/dev` and `refs/heads/main`, with no bypass actors: require a pull request, require **Atlas PR Target** from the GitHub Actions integration, require the branch to be current with its base, block force pushes, and prevent deletion. Preserve all existing checks and review requirements. Verify both ordinary feature → main and fork dev → main merges are blocked.
5. The guard fails PRs against any other base, but protection of only `dev`/`main` does **not** make that failure mandatory on arbitrary feature branches. Do not describe that configuration as a server ban on every other PR target. Broad required-status rules also constrain direct feature-branch pushes. A repository-wide required-workflow policy (where supported) or a separately reviewed merge-access design is needed for universal server enforcement without disrupting feature development.

On 2026-10-16, the Atlas organization reported `plan.name: free`. `atlas-verified/platform-web` is private; `GET /repos/atlas-verified/platform-web/rulesets` and both `GET /repos/atlas-verified/platform-web/branches/{main,dev}/protection` returned HTTP 403: “Upgrade to GitHub Pro or make this repository public to enable this feature.” The message is generic; the applicable paid organization plan is GitHub Team or Enterprise. No plan or visibility change was made. There is no native required-check configuration available for this private repository on the observed Free plan. A webhook bot that closes/reopens or retargets PRs is asynchronous and is not a substitute for merge blocking.

The public `agent-model-provenance` and `brand-assets` repositories returned empty ruleset lists, so public-repository rules are available but not configured. Their missing `dev` branches must be initialized from their current `main` commits before an implementation PR can target `dev`; that initialization is not a production release.

References:
- [GitHub default-branch workflow behavior](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/)
- [Ruleset availability and required checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
