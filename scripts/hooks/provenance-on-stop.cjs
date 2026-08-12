#!/usr/bin/env node
/**
 * stop: if session-touched files still lack provenance or plan fields, force one remediation turn.
 */

const fs = require('fs')
const path = require('path')
const {
  findRepoRoot,
  loadSession,
  classifyPath,
  validateCommentableFile,
  validateNonCommentableFile,
  saveSession,
  formatActivePlanStanza,
  isRealPlanId,
} = require('../lib/agent-provenance.cjs')

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
  })
}

function revalidate(repoRoot, session) {
  const pending = []
  const options = { activePlan: session.active_plan || null }
  for (const rel of Object.keys(session.files || {})) {
    const kind = classifyPath(rel)
    if (kind === 'ignore') continue
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs)) continue
    let errors = []
    if (kind === 'commentable') errors = validateCommentableFile(abs, rel, options)
    else if (kind === 'sidecar') errors = validateNonCommentableFile(repoRoot, rel, options)
    if (errors.length) {
      pending.push({ rel, error: errors[0] })
      session.files[rel] = { status: `fail:${errors[0]}`, updated_at: new Date().toISOString() }
    } else {
      session.files[rel] = { status: 'ok', updated_at: new Date().toISOString() }
    }
  }
  session.pending = pending.map((p) => p.rel)
  return pending
}

async function main() {
  let payload = {}
  try {
    const raw = await readStdin()
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    process.stdout.write('{}\n')
    process.exit(0)
  }

  try {
    if (payload.status && payload.status !== 'completed') {
      process.stdout.write('{}\n')
      process.exit(0)
    }

    // loop_count >= 1 means we already forced one remediation — do not infinite-loop
    if (Number(payload.loop_count || 0) >= 1) {
      process.stdout.write('{}\n')
      process.exit(0)
    }

    const repoRoot = findRepoRoot(
      (payload.workspace_roots && payload.workspace_roots[0]) || process.cwd()
    )
    const conversationId = payload.conversation_id || 'default'
    const session = loadSession(repoRoot, conversationId)
    if (!session.files || !Object.keys(session.files).length) {
      process.stdout.write('{}\n')
      process.exit(0)
    }

    const pending = revalidate(repoRoot, session)
    saveSession(repoRoot, conversationId, session)

    if (!pending.length) {
      process.stdout.write('{}\n')
      process.exit(0)
    }

    const list = pending
      .slice(0, 20)
      .map((p) => `- ${p.rel}: ${p.error}`)
      .join('\n')

    const parts = [
      'PROVENANCE GATE: You edited files without valid atlas-agent-provenance/v1 attribution.',
      'Do not start new feature work. Fix provenance on every file below, then stop.',
      'Rules: in-file header for commentable sources; sidecar ONLY for JSON/lockfiles/binaries; hunks: pending is invalid.',
      'If a plan is bound, plan_id: none is invalid — copy the ACTIVE PLAN fields below.',
      'Helper: node scripts/provenance-hunks.cjs <file>',
      'Checker: node scripts/check-agent-provenance.cjs --files <paths>',
      '',
      list,
    ]

    if (isRealPlanId(session.active_plan && session.active_plan.plan_id)) {
      parts.push('', formatActivePlanStanza(session.active_plan))
    }

    process.stdout.write(JSON.stringify({ followup_message: parts.join('\n') }) + '\n')
    process.exit(0)
  } catch {
    process.stdout.write('{}\n')
    process.exit(0)
  }
}

main()
