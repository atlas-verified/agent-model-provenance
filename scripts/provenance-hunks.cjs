#!/usr/bin/env node
/**
 * Suggest atlas-agent-provenance hunks coordinates from git diff for a file.
 *
 * Usage:
 *   node scripts/provenance-hunks.cjs path/to/file.ts
 *   node scripts/provenance-hunks.cjs --staged path/to/file.ts
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const {
  findRepoRoot,
  normalizeRelPath,
  extractProvenanceBlock,
} = require('./lib/agent-provenance.cjs')

function parseUnifiedHunks(diffText) {
  const hunks = []
  const re = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm
  let m
  while ((m = re.exec(diffText)) !== null) {
    const oldStart = Number(m[1])
    const oldCount = m[2] === undefined ? 1 : Number(m[2])
    const newStart = Number(m[3])
    const newCount = m[4] === undefined ? 1 : Number(m[4])
    hunks.push(`-${oldStart},${oldCount}:+${newStart},${newCount}`)
  }
  return hunks
}

function provenanceLineCount(absPath) {
  try {
    const content = fs.readFileSync(absPath, 'utf8')
    const block = extractProvenanceBlock(content)
    if (!block) return null
    return block.split(/\r?\n/).length
  } catch {
    return null
  }
}

function main() {
  const args = process.argv.slice(2)
  const staged = args.includes('--staged')
  const fileArg = args.find((a) => !a.startsWith('--'))
  if (!fileArg) {
    console.error('Usage: node scripts/provenance-hunks.cjs [--staged] <file>')
    process.exit(1)
  }

  const repoRoot = findRepoRoot(process.cwd())
  const rel = normalizeRelPath(fileArg, repoRoot)
  const abs = path.join(repoRoot, rel)

  let diff = ''
  try {
    const gitArgs = staged
      ? ['diff', '--cached', '-U0', '--', rel]
      : ['diff', 'HEAD', '-U0', '--', rel]
    diff = execFileSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8' })
  } catch (err) {
    diff = (err && err.stdout) || ''
  }

  const hunks = parseUnifiedHunks(diff)
  const provLines = provenanceLineCount(abs)

  if (hunks.length === 0) {
    console.log('none')
    console.error(`# No semantic git diff for ${rel}. Use hunks: none for provenance-only edits.`)
    if (provLines) {
      console.error(`# Note: file currently has a ~${provLines}-line provenance block to exclude.`)
    }
    process.exit(0)
  }

  console.log(hunks.join(' '))
  console.error(`# Suggested hunks for ${rel} (verify provenance block lines are excluded)`)
  if (provLines) {
    console.error(
      `# File has a ~${provLines}-line provenance header — do not include those lines in hunks.`
    )
  }
}

main()
