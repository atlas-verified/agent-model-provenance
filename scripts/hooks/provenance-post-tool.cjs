#!/usr/bin/env node
/**
 * postToolUse: bind active_plan from CreatePlan / sprint writes; inject
 * additional_context when session has files missing provenance or plan fields.
 */

const fs = require('fs')
const path = require('path')
const {
  findRepoRoot,
  loadSession,
  saveSession,
  classifyPath,
  validateCommentableFile,
  validateNonCommentableFile,
  maybeBindPlanFromToolPayload,
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
    const tool = String(payload.tool_name || '')
    if (!/(Write|StrReplace|EditNotebook|Delete|TabWrite|CreatePlan)/i.test(tool)) {
      process.stdout.write('{}\n')
      process.exit(0)
    }

    const repoRoot = findRepoRoot(
      (payload.workspace_roots && payload.workspace_roots[0]) || process.cwd()
    )
    const conversationId = payload.conversation_id || 'default'

    maybeBindPlanFromToolPayload(repoRoot, conversationId, payload)

    const session = loadSession(repoRoot, conversationId)
    const options = { activePlan: session.active_plan || null }

    // Revalidate every tracked file so fixed headers clear stale pending state.
    const pending = []
    for (const rel of Object.keys(session.files || {})) {
      const kind = classifyPath(rel)
      if (kind === 'ignore') continue
      const abs = path.join(repoRoot, rel)
      if (!fs.existsSync(abs)) continue
      let errors = []
      if (kind === 'commentable') errors = validateCommentableFile(abs, rel, options)
      else if (kind === 'sidecar') errors = validateNonCommentableFile(repoRoot, rel, options)
      if (errors.length) {
        pending.push(rel)
        session.files[rel] = { status: `fail:${errors[0]}`, updated_at: new Date().toISOString() }
      } else {
        session.files[rel] = { status: 'ok', updated_at: new Date().toISOString() }
      }
    }
    session.pending = pending
    saveSession(repoRoot, conversationId, session)

    if (!pending.length) {
      process.stdout.write('{}\n')
      process.exit(0)
    }

    const list = pending
      .slice(0, 12)
      .map((p) => `- ${p} (${session.files[p]?.status || 'missing'})`)
      .join('\n')

    const parts = [
      'AGENT EDIT PROVENANCE REQUIRED (enforced):',
      'These session-touched files are missing a valid atlas-agent-provenance/v1 record, still have hunks: pending, or have plan_id: none while a plan is bound.',
      'Before more edits or finishing, add/replace the in-file header (commentable) or append a sidecar line (JSON/lockfiles only).',
      'Sidecar is NOT allowed for .ts/.tsx/.md/etc. See rules/agent-edit-provenance.mdc and the plugin README.',
      'Suggested hunks helper: node scripts/provenance-hunks.cjs <file>',
      '',
      list,
    ]

    if (isRealPlanId(session.active_plan && session.active_plan.plan_id)) {
      parts.push('', formatActivePlanStanza(session.active_plan))
    }

    process.stdout.write(JSON.stringify({ additional_context: parts.join('\n') }) + '\n')
    process.exit(0)
  } catch {
    process.stdout.write('{}\n')
    process.exit(0)
  }
}

main()
