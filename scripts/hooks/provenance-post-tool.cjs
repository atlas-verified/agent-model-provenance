#!/usr/bin/env node
/**
 * postToolUse: inject additional_context when session has files missing provenance.
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
    // Only remind after edit-like tools
    if (!/(Write|StrReplace|EditNotebook|Delete|TabWrite)/i.test(tool)) {
      process.stdout.write('{}\n')
      process.exit(0)
    }

    const repoRoot = findRepoRoot(
      (payload.workspace_roots && payload.workspace_roots[0]) || process.cwd()
    )
    const conversationId = payload.conversation_id || 'default'
    const session = loadSession(repoRoot, conversationId)

    // Revalidate every tracked file so fixed headers clear stale pending state.
    const pending = []
    for (const rel of Object.keys(session.files || {})) {
      const kind = classifyPath(rel)
      if (kind === 'ignore') continue
      const abs = path.join(repoRoot, rel)
      if (!fs.existsSync(abs)) continue
      let errors = []
      if (kind === 'commentable') errors = validateCommentableFile(abs, rel)
      else if (kind === 'sidecar') errors = validateNonCommentableFile(repoRoot, rel)
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
    const additional_context = [
      'AGENT EDIT PROVENANCE REQUIRED (enforced):',
      'These session-touched files are missing a valid atlas-agent-provenance/v1 record or still have hunks: pending.',
      'Before more edits or finishing, add/replace the in-file header (commentable) or append a sidecar line (JSON/lockfiles only).',
      'Sidecar is NOT allowed for .ts/.tsx/.md/etc. See rules/agent-edit-provenance.mdc and the plugin README.',
      'Suggested hunks helper: node scripts/provenance-hunks.cjs <file>',
      '',
      list,
    ].join('\n')

    process.stdout.write(JSON.stringify({ additional_context }) + '\n')
    process.exit(0)
  } catch {
    process.stdout.write('{}\n')
    process.exit(0)
  }
}

main()
