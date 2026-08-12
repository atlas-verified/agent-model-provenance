#!/usr/bin/env node
/**
 * afterFileEdit: record touched paths + provenance status for this conversation.
 * Also bind active_plan when a sprint markdown or Cursor plan file is edited.
 * Official afterFileEdit output is fire-and-forget (no additional_context).
 */

const fs = require('fs')
const path = require('path')
const {
  findRepoRoot,
  normalizeRelPath,
  classifyPath,
  validateCommentableFile,
  validateNonCommentableFile,
  recordSessionEdit,
  loadSession,
  maybeBindPlanFromEditedPath,
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
    const repoRoot = findRepoRoot(
      (payload.workspace_roots && payload.workspace_roots[0]) || process.cwd()
    )
    const conversationId = payload.conversation_id || 'default'
    const rel = normalizeRelPath(payload.file_path, repoRoot)

    // Bind plan first so subsequent validation sees active_plan
    if (payload.file_path) {
      maybeBindPlanFromEditedPath(repoRoot, conversationId, payload.file_path)
    }

    const kind = classifyPath(rel)
    if (kind === 'ignore' || !rel) {
      process.stdout.write('{}\n')
      process.exit(0)
    }

    const session = loadSession(repoRoot, conversationId)
    const options = { activePlan: session.active_plan || null }

    const abs = path.join(repoRoot, rel)
    let errors = []
    if (fs.existsSync(abs)) {
      if (kind === 'commentable') errors = validateCommentableFile(abs, rel, options)
      else if (kind === 'sidecar') errors = validateNonCommentableFile(repoRoot, rel, options)
    } else {
      errors = ['file missing after edit']
    }

    const status = errors.length ? `fail:${errors[0]}` : 'ok'
    recordSessionEdit(repoRoot, conversationId, rel, status)
  } catch {
    // fail open
  }

  process.stdout.write('{}\n')
  process.exit(0)
}

main()
