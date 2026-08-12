#!/usr/bin/env node
/**
 * Fail if touched files lack valid atlas-agent-provenance/v1 attribution.
 *
 * Usage:
 *   node scripts/check-agent-provenance.cjs              # staged files (pre-commit)
 *   node scripts/check-agent-provenance.cjs --staged
 *   node scripts/check-agent-provenance.cjs --ci         # diff vs origin/dev or BASE_REF
 *   node scripts/check-agent-provenance.cjs --files a.ts b.json
 *
 * Escape hatch (intentional human-only commits):
 *   SKIP_AGENT_PROVENANCE=1 git commit ...
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const {
  findRepoRoot,
  normalizeRelPath,
  classifyPath,
  validateCommentableFile,
  validateNonCommentableFile,
  SIDECAR_REL,
} = require('./lib/agent-provenance.cjs')

function usage() {
  console.log(`Usage: node scripts/check-agent-provenance.cjs [--staged|--ci|--files ...]

Checks commentable files for in-file atlas-agent-provenance/v1 headers.
Checks non-commentable files for a matching sidecar line in ${SIDECAR_REL}.
Rejects hunks: pending. Sidecar cannot satisfy commentable files.

Skip: SKIP_AGENT_PROVENANCE=1`)
}

function gitLines(cmd, repoRoot) {
  try {
    const out = execSync(cmd, { cwd: repoRoot, encoding: 'utf8' })
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function resolveBaseRef(repoRoot) {
  const envBase = process.env.BASE_REF || process.env.GITHUB_BASE_REF
  if (envBase) {
    const candidate = envBase.includes('/') ? envBase : `origin/${envBase}`
    return candidate
  }
  for (const ref of ['origin/dev', 'origin/main', 'dev', 'main']) {
    try {
      execSync(`git rev-parse --verify ${ref}`, { cwd: repoRoot, stdio: 'ignore' })
      return ref
    } catch {
      // try next
    }
  }
  return 'HEAD~1'
}

function collectFiles(mode, explicitFiles, repoRoot) {
  if (mode === 'files') {
    return explicitFiles.map((f) => normalizeRelPath(f, repoRoot)).filter(Boolean)
  }
  if (mode === 'ci') {
    const base = resolveBaseRef(repoRoot)
    // merge-base when possible
    let range = `${base}...HEAD`
    try {
      const mb = execSync(`git merge-base ${base} HEAD`, { cwd: repoRoot, encoding: 'utf8' }).trim()
      if (mb) range = `${mb}...HEAD`
    } catch {
      // fall back to triple-dot / double-dot
      range = `${base}...HEAD`
    }
    const names = gitLines(`git diff --name-only --diff-filter=ACMR ${range}`, repoRoot)
    if (names.length) return names.map((f) => normalizeRelPath(f, repoRoot))
    return gitLines(`git diff --name-only --diff-filter=ACMR ${base} HEAD`, repoRoot).map((f) =>
      normalizeRelPath(f, repoRoot)
    )
  }
  // staged (default)
  const staged = gitLines('git diff --cached --name-only --diff-filter=ACMR', repoRoot)
  if (staged.length) return staged.map((f) => normalizeRelPath(f, repoRoot))
  // if nothing staged and not in hook, also allow unstaged for local dry-runs via --unstaged
  return []
}

function main() {
  if (process.env.SKIP_AGENT_PROVENANCE === '1') {
    console.log('check-agent-provenance: skipped (SKIP_AGENT_PROVENANCE=1)')
    process.exit(0)
  }

  const args = process.argv.slice(2)
  if (args.includes('-h') || args.includes('--help')) {
    usage()
    process.exit(0)
  }

  let mode = 'staged'
  let explicitFiles = []
  if (args.includes('--ci')) mode = 'ci'
  else if (args.includes('--staged')) mode = 'staged'
  else if (args.includes('--files')) {
    mode = 'files'
    explicitFiles = args.slice(args.indexOf('--files') + 1).filter((a) => !a.startsWith('--'))
  } else if (args.includes('--unstaged')) {
    mode = 'unstaged'
  }

  const repoRoot = findRepoRoot(process.cwd())
  let files
  if (mode === 'unstaged') {
    files = gitLines('git diff --name-only --diff-filter=ACMR HEAD', repoRoot).map((f) =>
      normalizeRelPath(f, repoRoot)
    )
  } else {
    files = collectFiles(mode, explicitFiles, repoRoot)
  }

  // unique
  files = [...new Set(files)]

  if (files.length === 0) {
    console.log('check-agent-provenance: no files to check')
    process.exit(0)
  }

  const failures = []

  for (const rel of files) {
    const kind = classifyPath(rel)
    if (kind === 'ignore') continue
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs)) continue

    let errors = []
    if (kind === 'commentable') {
      errors = validateCommentableFile(abs, rel)
    } else if (kind === 'sidecar') {
      errors = validateNonCommentableFile(repoRoot, rel)
    }
    if (errors.length) {
      failures.push({ file: rel, kind, errors })
    }
  }

  if (failures.length === 0) {
    console.log(`check-agent-provenance: ok (${files.length} path(s) scanned)`)
    process.exit(0)
  }

  console.error('check-agent-provenance: FAILED — missing or invalid agent provenance\n')
  for (const f of failures) {
    console.error(`  ${f.file} [${f.kind}]`)
    for (const e of f.errors) console.error(`    - ${e}`)
  }
  console.error(`
Fix:
  - Commentable sources: add/replace top-of-file atlas-agent-provenance/v1 block (see plugin README / rules/agent-edit-provenance.mdc)
  - Non-commentable (JSON/lockfiles/etc.): append a line to ${SIDECAR_REL}
  - Never use the sidecar for .ts/.tsx/.md/etc.
  - hunks: pending is rejected — run: node scripts/provenance-hunks.cjs <file>
  - Human-only bypass: SKIP_AGENT_PROVENANCE=1
`)
  process.exit(1)
}

main()
