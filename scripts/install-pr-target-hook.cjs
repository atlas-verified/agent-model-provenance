#!/usr/bin/env node
/* atlas-agent-provenance/v1
 * schema: atlas-agent-provenance/v1
 * change_id: 62e67d7c-303f-4c6e-bd96-e3c9f9e1a18e
 * timestamp: 2026-10-16T04:05:48.290373Z
 * file: scripts/install-pr-target-hook.cjs
 * change_kind: create
 * base_commit: 335144c992b498d6f15810adb61f25c94b59bea4
 * hunks: -0,0:+1,54
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

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const hookPath = fs.existsSync(path.join(root, '.githooks/pre-push')) ? '.githooks' : 'githooks';
if (!fs.existsSync(path.join(root, hookPath, 'pre-push'))) throw new Error('Repository pre-push hook is missing.');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const current = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' });
if (current.status !== 0 && current.status !== 1) throw new Error('Cannot read existing Git hook configuration.');
if (current.stdout.trim() && path.resolve(root, current.stdout.trim()) !== path.join(root, hookPath)) {
  throw new Error(`Existing hooksPath ${current.stdout.trim()} must be integrated manually; refusing to replace it.`);
}
if (!current.stdout.trim()) {
  const defaults = path.resolve(root, git(['rev-parse', '--git-path', 'hooks']));
  if (fs.existsSync(defaults) && fs.readdirSync(defaults).some((name) => !name.endsWith('.sample'))) {
    throw new Error('Existing default Git hooks must be integrated manually; refusing to hide them.');
  }
}
git(['config', '--local', 'core.hooksPath', hookPath]);
console.log(`Enabled ${hookPath}; existing hooks in that directory are preserved.`);
const branch = git(['branch', '--show-current']);
if (branch) {
  git(['config', '--local', `branch.${branch}.gh-merge-base`, 'dev']);
  console.log(`gh pr create defaults to dev for ${branch}. Always pass --base dev explicitly.`);
}
