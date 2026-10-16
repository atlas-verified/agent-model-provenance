/* atlas-agent-provenance/v1
 * schema: atlas-agent-provenance/v1
 * change_id: 620a8446-96d2-4dd1-9b1d-55749142ea0b
 * timestamp: 2026-10-16T04:05:48.289920Z
 * file: scripts/pr-target-policy.cjs
 * change_kind: create
 * base_commit: 335144c992b498d6f15810adb61f25c94b59bea4
 * hunks: -0,0:+1,43
 * coder_runtime: codex-desktop
 * coder_model: Codex (GPT-6)
 * coder_model_id: not_exposed
 * coder_reasoning: not_exposed
 * coder_max_mode: not_exposed
 * coder_mode: agent
 * coder_context_window: not_exposed
 * plan_id: atlas-dev-pr-routing
 * plan_path: dev-workflow/PR-TARGET-POLICY.md
 * plan_revision: 7ad024450572908b34c55d77c7e1a7f07be592c3dd399672fd5e9942d1627192
 * planner_model: Codex (GPT-6)
 * planner_model_id: not_exposed
 * planner_reasoning: not_exposed
 * planner_max_mode: not_exposed
 * planner_context_window: not_exposed
 * fixes_change_ids: none
 */

'use strict';

function validatePullRequest(pr, repository) {
  const validRepo = (repo) => Number.isSafeInteger(repo?.id) && repo.id > 0
    && typeof repo.full_name === 'string' && /^[^/\s]+\/[^/\s]+$/.test(repo.full_name);
  const sameRepo = (a, b) => validRepo(a) && validRepo(b)
    && a.id === b.id && a.full_name.toLowerCase() === b.full_name.toLowerCase();
  if (!validRepo(repository) || !sameRepo(pr?.base?.repo, repository)
      || !validRepo(pr?.head?.repo) || typeof pr.head.ref !== 'string' || !pr.head.ref) {
    throw new Error('Cannot verify PR repository and branch metadata; refusing to pass.');
  }
  if (pr.base.ref === 'dev') return;
  if (pr.base.ref === 'main' && pr.head.ref === 'dev' && sameRepo(pr.head.repo, repository)) return;
  throw new Error('Atlas PR policy: ordinary PRs must target dev. Only same-repository dev -> main is allowed for a deliberate production promotion.');
}

module.exports = { validatePullRequest };
