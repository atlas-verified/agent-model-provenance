#!/usr/bin/env node
/* atlas-agent-provenance/v1
 * schema: atlas-agent-provenance/v1
 * change_id: 9bc0c5bd-d4e6-4ad1-b5ae-3c79968c34ad
 * timestamp: 2026-10-16T04:05:48.290239Z
 * file: scripts/pr-target-pre-push.cjs
 * change_kind: create
 * base_commit: 335144c992b498d6f15810adb61f25c94b59bea4
 * hunks: -0,0:+1,86
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

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { validatePullRequest } = require('./pr-target-policy.cjs');

function repositoryFromRemote(remoteUrl) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remoteUrl);
  if (!match) throw new Error('PR preflight requires a github.com remote URL; cannot verify this destination.');
  return match[1];
}

function preflight(remoteUrl, input, api) {
  const repo = repositoryFromRemote(remoteUrl);
  const branches = new Set();
  for (const line of input.split(/\r?\n/).filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) throw new Error('Invalid Git pre-push input.');
    const [localRef, localSha, remoteRef] = fields;
    if (remoteRef === 'refs/heads/main' || remoteRef === 'refs/heads/dev') {
      throw new Error('Direct pushes/deletions of main or dev are blocked. Open an ordinary PR to dev; promote only with a deliberate dev -> main PR.');
    }
    if (localRef === '(delete)' || /^0+$/.test(localSha) || !remoteRef.startsWith('refs/heads/')) continue;
    branches.add(remoteRef.slice('refs/heads/'.length));
  }
  for (const branch of branches) {
    // Explicit host + encoded data, no shell interpolation. Check every page.
    const head = encodeURIComponent(`${repo.split('/')[0]}:${branch}`);
    const prs = api(`repos/${repo}/pulls?state=open&head=${head}&per_page=100`);
    if (!Array.isArray(prs)) throw new Error('Invalid GitHub response; PR preflight failed closed.');
    for (const pr of prs) {
      if (pr?.base?.repo?.full_name?.toLowerCase() !== repo.toLowerCase()) {
        throw new Error('GitHub returned a different base repository.');
      }
      try { validatePullRequest(pr, pr.base.repo); }
      catch (error) { throw new Error(`PR #${pr.number}: ${error.message}`); }
    }
  }
}

if (require.main === module) {
  try {
    preflight(process.argv[3] || '', fs.readFileSync(0, 'utf8'), (endpoint) => {
      const result = execFileSync('gh', ['api', '--hostname', 'github.com', '--paginate', '--slurp', endpoint], {
        encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const pages = JSON.parse(result);
      if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error('Invalid paginated GitHub response.');
      return pages.flat();
    });
  } catch (error) {
    console.error(`PR target preflight blocked the push: ${error.message}`);
    console.error('Resolve the PR target or GitHub access error, then retry. Do not bypass the hook.');
    process.exitCode = 1;
  }
}

module.exports = { preflight, repositoryFromRemote };
