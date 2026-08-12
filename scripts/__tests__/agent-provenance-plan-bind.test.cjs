'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { describe, it, before, after } = require('node:test')

const {
  parseSprintPlanProvenance,
  planIdFromCursorPlanName,
  sha256Text,
  validateProvenanceFields,
  validateAgainstActivePlan,
  isPlanNone,
  setSessionActivePlan,
  loadSession,
  maybeBindPlanFromEditedPath,
  extractPlanFromCommitSet,
  validateCommitSetPlanConsistency,
  formatActivePlanStanza,
  activePlanFromCursorPlanFile,
} = require('../lib/agent-provenance.cjs')

const FIXTURE_SPRINT = `# Example Sprint

## Plan provenance

- plan_id: example-feature
- plan_path: .cursor/markdown-working-roadmap/340-EXAMPLE-FEATURE-SPRINT.md
- plan_revision: abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
- planner_model: Cursor Grok 4.5
- planner_model_id: not_exposed
- planner_reasoning: not_exposed
- planner_max_mode: not_exposed
- planner_context_window: not_exposed
- approved_at: 2026-08-12T18:00:00Z

## Goals

Ship the thing.
`

function baseFields(overrides = {}) {
  return {
    schema: 'atlas-agent-provenance/v1',
    change_id: '550e8400-e29b-41d4-a716-446655440000',
    timestamp: '2026-08-12T18:00:00Z',
    file: 'src/example.ts',
    change_kind: 'modify',
    base_commit: '0123456789abcdef0123456789abcdef01234567',
    hunks: '-12,3:+12,8',
    coder_runtime: 'cursor-agent',
    coder_model: 'Cursor Grok 4.5',
    coder_model_id: 'not_exposed',
    coder_reasoning: 'not_exposed',
    coder_max_mode: 'not_exposed',
    coder_mode: 'agent',
    coder_context_window: 'not_exposed',
    plan_id: 'none',
    plan_path: 'none',
    plan_revision: 'none',
    planner_model: 'none',
    planner_model_id: 'none',
    planner_reasoning: 'none',
    planner_max_mode: 'none',
    planner_context_window: 'none',
    fixes_change_ids: 'none',
    ...overrides,
  }
}

describe('parseSprintPlanProvenance', () => {
  it('parses Plan provenance stanza', () => {
    const plan = parseSprintPlanProvenance(FIXTURE_SPRINT)
    assert.ok(plan)
    assert.strictEqual(plan.plan_id, 'example-feature')
    assert.strictEqual(
      plan.plan_path,
      '.cursor/markdown-working-roadmap/340-EXAMPLE-FEATURE-SPRINT.md'
    )
    assert.strictEqual(
      plan.plan_revision,
      'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
    )
    assert.strictEqual(plan.planner_model, 'Cursor Grok 4.5')
  })

  it('returns null when plan_id is none', () => {
    const plan = parseSprintPlanProvenance(`## Plan provenance\n\n- plan_id: none\n`)
    assert.strictEqual(plan, null)
  })

  it('returns null without stanza', () => {
    assert.strictEqual(parseSprintPlanProvenance('# No plan here\n'), null)
  })
})

describe('planIdFromCursorPlanName', () => {
  it('kebab-cases and strips salt', () => {
    assert.strictEqual(
      planIdFromCursorPlanName('tv_login_canvas_fix_d643570b.plan.md'),
      'tv-login-canvas-fix'
    )
  })
})

describe('sha256Text', () => {
  it('normalizes CRLF', () => {
    assert.strictEqual(sha256Text('a\r\nb\n'), sha256Text('a\nb\n'))
  })
})

describe('validateProvenanceFields vs active plan', () => {
  const active = {
    plan_id: 'example-feature',
    plan_path: '.cursor/markdown-working-roadmap/340-EXAMPLE-FEATURE-SPRINT.md',
    plan_revision: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    planner_model: 'Cursor Grok 4.5',
    planner_model_id: 'not_exposed',
    planner_reasoning: 'not_exposed',
    planner_max_mode: 'not_exposed',
    planner_context_window: 'not_exposed',
  }

  it('allows plan_id none when unbound', () => {
    const errors = validateProvenanceFields(baseFields(), 'src/example.ts')
    assert.deepStrictEqual(errors, [])
  })

  it('rejects plan_id none when bound', () => {
    const errors = validateProvenanceFields(baseFields(), 'src/example.ts', {
      activePlan: active,
    })
    assert.ok(errors.some((e) => /plan_id: none is invalid/.test(e)))
  })

  it('accepts matching plan fields when bound', () => {
    const errors = validateProvenanceFields(
      baseFields({
        plan_id: active.plan_id,
        plan_path: active.plan_path,
        plan_revision: active.plan_revision,
        planner_model: active.planner_model,
        planner_model_id: active.planner_model_id,
        planner_reasoning: active.planner_reasoning,
        planner_max_mode: active.planner_max_mode,
        planner_context_window: active.planner_context_window,
      }),
      'src/example.ts',
      { activePlan: active }
    )
    assert.deepStrictEqual(errors, [])
  })

  it('validateAgainstActivePlan flags mismatch', () => {
    const errors = validateAgainstActivePlan(
      baseFields({ plan_id: 'other-plan', plan_path: 'x', plan_revision: 'y' }),
      active
    )
    assert.ok(errors.some((e) => /does not match active plan/.test(e)))
  })
})

describe('formatActivePlanStanza', () => {
  it('includes copy instruction', () => {
    const s = formatActivePlanStanza({
      plan_id: 'example-feature',
      plan_path: 'p.md',
      plan_revision: 'abc',
      planner_model: 'm',
      planner_model_id: 'not_exposed',
      planner_reasoning: 'not_exposed',
      planner_max_mode: 'not_exposed',
      planner_context_window: 'not_exposed',
    })
    assert.match(s, /plan_id: example-feature/)
    assert.match(s, /Do NOT use plan_id: none/)
  })
})

describe('session bind + commit-set heuristic', () => {
  let tmp

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-plan-'))
    fs.mkdirSync(path.join(tmp, '.cursor', 'markdown-working-roadmap'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true })
  })

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('binds active_plan from sprint markdown edit', () => {
    const rel = '.cursor/markdown-working-roadmap/340-EXAMPLE-FEATURE-SPRINT.md'
    const abs = path.join(tmp, rel)
    fs.writeFileSync(abs, FIXTURE_SPRINT)
    const plan = maybeBindPlanFromEditedPath(tmp, 'conv-test', abs)
    assert.ok(plan)
    assert.strictEqual(plan.plan_id, 'example-feature')
    const session = loadSession(tmp, 'conv-test')
    assert.strictEqual(session.active_plan.plan_id, 'example-feature')
  })

  it('binds from Cursor plan file', () => {
    const plansDir = path.join(tmp, '.cursor', 'plans')
    fs.mkdirSync(plansDir, { recursive: true })
    const planPath = path.join(plansDir, 'demo_feature_abc123.plan.md')
    fs.writeFileSync(
      planPath,
      '---\nname: Demo Feature\noverview: x\ntodos: []\nisProject: false\n---\n\n# Body\n\nHello\n'
    )
    const plan = activePlanFromCursorPlanFile(planPath)
    assert.strictEqual(plan.plan_id, 'demo-feature')
    assert.ok(!isPlanNone(plan.plan_revision))
    assert.strictEqual(plan.plan_revision, sha256Text('# Body\n\nHello\n'))
  })

  it('setSessionActivePlan persists', () => {
    setSessionActivePlan(tmp, 'conv-2', {
      plan_id: 'persist-me',
      plan_path: 'x.md',
      plan_revision: 'r'.repeat(64),
    })
    const s = loadSession(tmp, 'conv-2')
    assert.strictEqual(s.active_plan.plan_id, 'persist-me')
  })

  it('extractPlanFromCommitSet picks sprint plan', () => {
    const rel = '.cursor/markdown-working-roadmap/340-EXAMPLE-FEATURE-SPRINT.md'
    fs.writeFileSync(path.join(tmp, rel), FIXTURE_SPRINT)
    const plan = extractPlanFromCommitSet(tmp, [rel, 'src/example.ts'])
    assert.ok(plan)
    assert.strictEqual(plan.plan_id, 'example-feature')
  })

  it('validateCommitSetPlanConsistency fails none headers when sprint present', () => {
    const sprintRel = '.cursor/markdown-working-roadmap/340-EXAMPLE-FEATURE-SPRINT.md'
    fs.writeFileSync(path.join(tmp, sprintRel), FIXTURE_SPRINT)

    const tsRel = 'src/example.ts'
    const header = `/* atlas-agent-provenance/v1
 * schema: atlas-agent-provenance/v1
 * change_id: 550e8400-e29b-41d4-a716-446655440000
 * timestamp: 2026-08-12T18:00:00Z
 * file: src/example.ts
 * change_kind: modify
 * base_commit: 0123456789abcdef0123456789abcdef01234567
 * hunks: none
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
export const x = 1
`
    fs.writeFileSync(path.join(tmp, tsRel), header)

    const failures = validateCommitSetPlanConsistency(tmp, [sprintRel, tsRel])
    assert.ok(failures.length >= 1)
    assert.ok(failures.some((f) => f.file === tsRel && /plan_id: none is invalid/.test(f.errors[0])))
  })

  it('validateCommitSetPlanConsistency allows none when no sprint', () => {
    const tsRel = 'src/lonely.ts'
    const header = `/* atlas-agent-provenance/v1
 * schema: atlas-agent-provenance/v1
 * change_id: 550e8400-e29b-41d4-a716-446655440001
 * timestamp: 2026-08-12T18:00:00Z
 * file: src/lonely.ts
 * change_kind: modify
 * base_commit: 0123456789abcdef0123456789abcdef01234567
 * hunks: none
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
export const y = 2
`
    fs.writeFileSync(path.join(tmp, tsRel), header)
    const failures = validateCommitSetPlanConsistency(tmp, [tsRel])
    assert.deepStrictEqual(failures, [])
  })
})
