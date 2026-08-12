#!/usr/bin/env node
/**
 * beforeSubmitPrompt: bind active_plan from attached sprint docs / .plan.md files.
 * Always continue: true — this is attribution binding, not a prompt gate.
 */

const {
  findRepoRoot,
  maybeBindPlanFromPromptAttachments,
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
    process.stdout.write(JSON.stringify({ continue: true }) + '\n')
    process.exit(0)
  }

  try {
    const repoRoot = findRepoRoot(
      (payload.workspace_roots && payload.workspace_roots[0]) || process.cwd()
    )
    const conversationId = payload.conversation_id || 'default'
    maybeBindPlanFromPromptAttachments(repoRoot, conversationId, payload.attachments || [])
  } catch {
    // fail open
  }

  process.stdout.write(JSON.stringify({ continue: true }) + '\n')
  process.exit(0)
}

main()
