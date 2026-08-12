#!/usr/bin/env node
/**
 * afterFileEdit: record touched paths + provenance status for this conversation.
 * Official afterFileEdit output is fire-and-forget (no additional_context).
 * Reminder injection happens in postToolUse; stop forces remediation.
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
    const rel = normalizeRelPath(payload.file_path, repoRoot)
    const kind = classifyPath(rel)
    if (kind === 'ignore' || !rel) {
      process.stdout.write('{}\n')
      process.exit(0)
    }

    const abs = path.join(repoRoot, rel)
    let errors = []
    if (fs.existsSync(abs)) {
      if (kind === 'commentable') errors = validateCommentableFile(abs, rel)
      else if (kind === 'sidecar') errors = validateNonCommentableFile(repoRoot, rel)
    } else {
      errors = ['file missing after edit']
    }

    const status = errors.length ? `fail:${errors[0]}` : 'ok'
    recordSessionEdit(repoRoot, payload.conversation_id || 'default', rel, status)
  } catch {
    // fail open
  }

  process.stdout.write('{}\n')
  process.exit(0)
}

main()
