/* atlas-agent-provenance/v1
 * schema: atlas-agent-provenance/v1
 * change_id: 91cc1947-7811-424f-8573-56b054342091
 * timestamp: 2026-10-16T04:05:48.290069Z
 * file: scripts/pr-target-guard.test.cjs
 * change_kind: create
 * base_commit: 335144c992b498d6f15810adb61f25c94b59bea4
 * hunks: -0,0:+1,187
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

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { validatePullRequest } = require('./pr-target-policy.cjs');
const { preflight, repositoryFromRemote } = require('./pr-target-pre-push.cjs');
const repository = { id: 1, full_name: 'atlas-verified/example' };
const fork = { id: 2, full_name: 'contributor/example' };
const pr = (base, head = 'feature/example', repo = repository) => ({
  number: 42, base: { ref: base, repo: repository }, head: { ref: head, repo },
});
const cases = [
  ['feature to dev', pr('dev'), true],
  ['fork feature to dev', pr('dev', 'feature/test', fork), true],
  ['deliberate promotion', pr('main', 'dev'), true],
  ['feature directly to main', pr('main'), false],
  ['release branch to main', pr('main', 'release/ready'), false],
  ['fork named dev to main', pr('main', 'dev', fork), false],
  ['spoofed repository name', pr('main', 'dev', { ...repository, id: 2 }), false],
  ['spoofed repository id', pr('main', 'dev', { ...fork, id: 1 }), false],
  ['develop target', pr('develop'), false],
  ['release target', pr('release/next'), false],
  ['feature target', pr('feature/parent'), false],
  ['dev branch lookalike', pr('main', 'Dev'), false],
  ['deleted head repository', pr('dev', 'feature/test', null), false],
  ['missing PR', null, false],
  ['missing base', { head: pr('dev').head }, false],
  ['missing head', { base: pr('dev').base }, false],
  ['missing branch', pr('main', ''), false],
  ['wrong base repository', { ...pr('dev'), base: { ref: 'dev', repo: fork } }, false],
  ['untrusted branch text', pr('main', 'dev;echo-injected'), false],
];

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/pr-target-guard.yml'), 'utf8');
const inline = workflow.split("          node <<'NODE'\n")[1]?.split('\n          NODE')[0]
  ?.split('\n').map((line) => line.slice(10)).join('\n');

test('trusted workflow is metadata-only, unfiltered, unprivileged, and uses the exact tested policy', () => {
  assert.ok(inline, 'inline script must exist');
  assert.ok(inline.includes(validatePullRequest.toString()), 'workflow policy must match local implementation');
  assert.match(workflow, /pull_request_target:/);
  for (const event of ['opened', 'reopened', 'synchronize', 'edited', 'ready_for_review', 'converted_to_draft']) {
    assert.ok(workflow.includes(event));
  }
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /name: Atlas PR Target/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.doesNotMatch(workflow, /\buses:|\bif:|\bpaths:|\bbranches:|secrets\.|checkout|curl|wget/);
  assert.doesNotMatch(inline, /\$\{\{/);
});

for (const [name, payload, allowed] of cases) {
  test(`local and actual workflow script: ${name}`, (t) => {
    if (allowed) assert.doesNotThrow(() => validatePullRequest(payload, repository));
    else assert.throws(() => validatePullRequest(payload, repository));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-pr-case-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const event = path.join(dir, 'event.json');
    fs.writeFileSync(event, JSON.stringify({ pull_request: payload, repository }));
    const result = spawnSync(process.execPath, ['-'], {
      input: inline, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: event },
    });
    assert.equal(result.status, allowed ? 0 : 1, result.stderr);
  });
}

test('malformed event JSON fails closed', () => {
  const result = spawnSync(process.execPath, ['-'], {
    input: inline, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: __filename },
  });
  assert.equal(result.status, 1);
});

const remote = 'https://github.com/atlas-verified/example.git';
const update = (target, sha = 'a'.repeat(40)) => `refs/heads/local ${sha} refs/heads/${target} ${'b'.repeat(40)}\n`;
test('hook accepts standard GitHub remotes and rejects ambiguous destinations', () => {
  for (const url of [remote, 'git@github.com:atlas-verified/example.git', 'ssh://git@github.com/atlas-verified/example.git']) {
    assert.equal(repositoryFromRemote(url), repository.full_name);
  }
  for (const url of ['../local', 'https://github.com.evil/example/repo', 'https://token@github.com/example/repo']) {
    assert.throws(() => repositoryFromRemote(url));
  }
});
test('hook blocks pushes and deletions of protected destinations, including refspec renames', () => {
  for (const branch of ['main', 'dev']) for (const sha of ['a'.repeat(40), '0'.repeat(40)]) {
    assert.throws(() => preflight(remote, update(branch, sha), () => assert.fail('must not call API')));
  }
  assert.throws(() => preflight(remote, update('feature/ok') + update('main'), () => []));
});
test('hook checks every PR for every pushed branch and encodes branch names', () => {
  const endpoints = [];
  preflight(remote, update('feature/a+b') + update('feature/second'), (endpoint) => {
    endpoints.push(endpoint); return [pr('dev')];
  });
  assert.equal(endpoints.length, 2);
  assert.ok(endpoints[0].includes('head=atlas-verified%3Afeature%2Fa%2Bb'));
  assert.throws(() => preflight(remote, update('feature/test'), () => [pr('dev'), pr('main')]), /PR #42/);
});
test('hook allows first feature push but fails closed on API errors and malformed data', () => {
  assert.doesNotThrow(() => preflight(remote, update('feature/new'), () => []));
  assert.throws(() => preflight(remote, update('feature/new'), () => { throw new Error('offline'); }), /offline/);
  for (const response of [{}, [null], [{ ...pr('dev'), base: { ref: 'dev', repo: fork } }]]) {
    assert.throws(() => preflight(remote, update('feature/new'), () => response));
  }
  assert.throws(() => preflight(remote, 'malformed\n', () => []));
});
test('feature deletions and tags do not require a PR', () => {
  assert.doesNotThrow(() => preflight(remote, update('feature/old', '0'.repeat(40)), () => assert.fail('unexpected API call')));
  assert.doesNotThrow(() => preflight(remote, `refs/tags/v1 ${'a'.repeat(40)} refs/tags/v1 ${'0'.repeat(40)}\n`, () => assert.fail('unexpected API call')));
});
test('hook installer preserves existing pre-commit and refuses a conflicting hook directory', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-pr-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, '.githooks'));
  fs.copyFileSync(path.join(__dirname, 'install-pr-target-hook.cjs'), path.join(dir, 'scripts/install-pr-target-hook.cjs'));
  fs.writeFileSync(path.join(dir, '.githooks/pre-push'), 'placeholder');
  fs.writeFileSync(path.join(dir, '.githooks/pre-commit'), 'existing');
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-b', 'feature/test');
  git('config', 'core.hooksPath', '.githooks');
  let result = spawnSync(process.execPath, ['scripts/install-pr-target-hook.cjs'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git('config', 'branch.feature/test.gh-merge-base'), 'dev');
  assert.equal(fs.readFileSync(path.join(dir, '.githooks/pre-commit'), 'utf8'), 'existing');
  git('config', 'core.hooksPath', '.custom-hooks');
  result = spawnSync(process.execPath, ['scripts/install-pr-target-hook.cjs'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(git('config', 'core.hooksPath'), '.custom-hooks');
  git('config', '--unset', 'core.hooksPath');
  fs.writeFileSync(path.join(dir, '.git/hooks/pre-commit'), 'existing default hook');
  result = spawnSync(process.execPath, ['scripts/install-pr-target-hook.cjs'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Existing default Git hooks/);
});

test('real hook process checks paginated API data, passes arguments safely, and fails on CLI errors', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-pr-process-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stub = path.join(dir, 'gh');
  const log = path.join(dir, 'args.json');
  fs.writeFileSync(stub, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.ARGS_LOG, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(process.env.API_RESPONSE);\nprocess.exit(Number(process.env.API_EXIT || 0));\n`, { mode: 0o755 });
  const run = (response, exit = 0, input = update('feature/test')) => spawnSync(process.execPath,
    [path.join(__dirname, 'pr-target-pre-push.cjs'), 'origin', remote], {
      input, encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`,
        ARGS_LOG: log, API_RESPONSE: response, API_EXIT: String(exit) },
    });
  assert.equal(run(JSON.stringify([[pr('dev')]])).status, 0);
  const args = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.deepEqual(args.slice(0, 5), ['api', '--hostname', 'github.com', '--paginate', '--slurp']);
  assert.equal(run(JSON.stringify([[pr('dev')], [pr('main')]])).status, 1);
  assert.equal(run('invalid JSON').status, 1);
  assert.equal(run('[]', 1).status, 1);
  assert.equal(run('{}').status, 1);
  assert.equal(run('[]', 0, update('main')).status, 1);
});
