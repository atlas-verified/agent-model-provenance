/**
 * Shared helpers for atlas-agent-provenance/v1 enforcement.
 * Portable copy for the agent-model-provenance Cursor plugin.
 */

/**
 * Shared helpers for atlas-agent-provenance/v1 enforcement.
 * Used by check-agent-provenance.cjs, provenance-hunks.cjs, and Cursor hooks.
 */

const fs = require('fs')
const path = require('path')

const PROVENANCE_MARKER = 'atlas-agent-provenance/v1'
const SIDECAR_REL = path.join('.cursor', 'agent-provenance.jsonl')
const SESSION_DIR_REL = path.join('.cursor', '.provenance-session')

const REQUIRED_FIELDS = [
  'schema',
  'change_id',
  'timestamp',
  'file',
  'change_kind',
  'base_commit',
  'hunks',
  'coder_runtime',
  'coder_model',
  'coder_model_id',
  'coder_reasoning',
  'coder_max_mode',
  'coder_mode',
  'coder_context_window',
  'plan_id',
  'plan_path',
  'plan_revision',
  'planner_model',
  'planner_model_id',
  'planner_reasoning',
  'planner_max_mode',
  'planner_context_window',
  'fixes_change_ids',
]

/** Extensions / basenames that can hold in-file comment provenance. */
const COMMENTABLE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.less',
  '.py',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.md',
  '.mdc',
  '.mdx',
  '.html',
  '.htm',
  '.yml',
  '.yaml',
  '.toml',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.vue',
  '.svelte',
])

const COMMENTABLE_BASENAMES = new Set([
  'AGENTS.md',
  'Dockerfile',
  'Makefile',
  'Rakefile',
  'Gemfile',
  'pre-commit',
  'commit-msg',
  'pre-push',
  'prepare-commit-msg',
])

/** Paths never checked (generated / vendor / self-exempt). */
const IGNORE_PATH_PREFIXES = [
  'node_modules/',
  '.git/',
  'coverage/',
  '.next/',
  'dist/',
  'build/',
  'out/',
  'vendor/',
  '.turbo/',
  '.vercel/',
  '.cursor/.provenance-session/',
]

/** Any path segment named node_modules is ignored. */
function hasIgnoredSegment(relPath) {
  return relPath.split('/').includes('node_modules')
}

const IGNORE_EXACT = new Set([
  '.cursor/agent-provenance.jsonl',
])

function normalizeRelPath(filePath, repoRoot) {
  if (!filePath) return ''
  let p = filePath
  if (path.isAbsolute(p) && repoRoot) {
    p = path.relative(repoRoot, p)
  }
  p = p.replace(/\\/g, '/')
  if (p.startsWith('./')) p = p.slice(2)
  return p
}

function shouldIgnorePath(relPath) {
  if (!relPath || IGNORE_EXACT.has(relPath)) return true
  if (relPath.endsWith('.map')) return true
  if (hasIgnoredSegment(relPath)) return true
  if (relPath.endsWith('.lock') || relPath.endsWith('-lock.json') || relPath.endsWith('.lockb')) {
    // lockfiles are non-commentable but still need sidecar — do not ignore
  }
  return IGNORE_PATH_PREFIXES.some((prefix) => relPath.startsWith(prefix))
}

function isCommentablePath(relPath) {
  if (!relPath || shouldIgnorePath(relPath)) return false
  const base = path.basename(relPath)
  if (COMMENTABLE_BASENAMES.has(base)) return true
  // Dockerfiles without extension
  if (/^Dockerfile(\.|$)/i.test(base)) return true
  const ext = path.extname(base).toLowerCase()
  return COMMENTABLE_EXT.has(ext)
}

function isNonCommentableTrackedPath(relPath) {
  if (!relPath || shouldIgnorePath(relPath)) return false
  if (isCommentablePath(relPath)) return false
  // Only gate common agent-touchable non-commentable formats
  const ext = path.extname(relPath).toLowerCase()
  const base = path.basename(relPath)
  if (
    ext === '.json' ||
    ext === '.jsonl' ||
    base.endsWith('package-lock.json') ||
    base.endsWith('pnpm-lock.yaml') ||
    base.endsWith('yarn.lock') ||
    base === '.gitignore' ||
    base === '.dockerignore' ||
    base === '.npmrc' ||
    base === '.env.example'
  ) {
    return true
  }
  return false
}

function extractProvenanceBlock(content) {
  if (!content || !content.includes(PROVENANCE_MARKER)) return null

  // Only accept a provenance record near the top of the file so documentation
  // examples later in AGENTS.md / sprint docs are not mistaken for the live header.
  const headLines = content.split(/\r?\n/).slice(0, 80)
  const head = headLines.join('\n')

  const candidates = []

  const htmlRe = /<!--\s*atlas-agent-provenance\/v1[\s\S]*?-->/
  const cRe = /\/\*\s*atlas-agent-provenance\/v1[\s\S]*?\*\//
  for (const re of [htmlRe, cRe]) {
    const m = head.match(re)
    if (m && typeof m.index === 'number') {
      candidates.push({ index: m.index, text: m[0] })
    }
  }

  let hashStart = -1
  for (let i = 0; i < headLines.length; i++) {
    if (/^\s*#\s*atlas-agent-provenance\/v1\s*$/.test(headLines[i])) {
      hashStart = i
      break
    }
  }
  if (hashStart !== -1) {
    const collected = [headLines[hashStart]]
    for (let i = hashStart + 1; i < headLines.length; i++) {
      if (/^\s*#/.test(headLines[i])) {
        collected.push(headLines[i])
        continue
      }
      break
    }
    // Approximate index as character offset of the start line within head
    const index = headLines.slice(0, hashStart).join('\n').length + (hashStart > 0 ? 1 : 0)
    candidates.push({ index, text: collected.join('\n') })
  }

  if (!candidates.length) return null
  candidates.sort((a, b) => a.index - b.index)
  return candidates[0].text
}

function parseProvenanceFields(block) {
  if (!block) return null
  const fields = {}
  const lines = block.split(/\r?\n/)
  for (const line of lines) {
    const cleaned = line
      .replace(/^\s*\/\*+\s*/, '')
      .replace(/^\s*\*\s?/, '')
      .replace(/^\s*#\s?/, '')
      .replace(/^\s*<!--\s*/, '')
      .replace(/\s*-->\s*$/, '')
      .replace(/\s*\*\/\s*$/, '')
      .trim()
    const m = cleaned.match(/^([a-z_]+)\s*:\s*(.+)$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (!fields[key]) fields[key] = value
  }
  return fields
}

function validateProvenanceFields(fields, relPath) {
  const errors = []
  if (!fields) {
    errors.push('missing atlas-agent-provenance/v1 block')
    return errors
  }
  for (const key of REQUIRED_FIELDS) {
    if (fields[key] === undefined || fields[key] === '') {
      errors.push(`missing field: ${key}`)
    }
  }
  if (fields.schema && fields.schema !== PROVENANCE_MARKER) {
    errors.push(`schema must be ${PROVENANCE_MARKER}`)
  }
  if (fields.hunks && /^pending$/i.test(fields.hunks)) {
    errors.push('hunks: pending is invalid — finalize hunks or use "none" only for provenance-only edits')
  }
  if (fields.file && normalizeRelPath(fields.file) !== normalizeRelPath(relPath)) {
    // allow basename-only mismatch soft? No — require exact repo-relative path
    errors.push(`file field "${fields.file}" does not match path "${relPath}"`)
  }
  return errors
}

function validateCommentableFile(absPath, relPath) {
  let content
  try {
    content = fs.readFileSync(absPath, 'utf8')
  } catch (err) {
    return [`unreadable: ${err.message}`]
  }
  // Scan first ~120 lines + any early block (provenance must be near top)
  const head = content.slice(0, 12000)
  const block = extractProvenanceBlock(head)
  if (!block) {
    // also allow full-file scan for small files where preamble is long
    const fullBlock = extractProvenanceBlock(content)
    if (!fullBlock) {
      return [
        'missing in-file atlas-agent-provenance/v1 header (sidecar is NOT allowed for commentable files)',
      ]
    }
    const fields = parseProvenanceFields(fullBlock)
    return validateProvenanceFields(fields, relPath)
  }
  const fields = parseProvenanceFields(block)
  return validateProvenanceFields(fields, relPath)
}

function readSidecarEntries(repoRoot) {
  const abs = path.join(repoRoot, SIDECAR_REL)
  if (!fs.existsSync(abs)) return []
  const text = fs.readFileSync(abs, 'utf8')
  const entries = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed))
    } catch {
      // ignore malformed lines; checker will surface separately if needed
    }
  }
  return entries
}

function validateNonCommentableFile(repoRoot, relPath) {
  const entries = readSidecarEntries(repoRoot)
  const matches = entries.filter((e) => normalizeRelPath(e.file) === normalizeRelPath(relPath))
  if (matches.length === 0) {
    return [
      `missing sidecar line in ${SIDECAR_REL} for non-commentable file (in-file comments not allowed)`,
    ]
  }
  const latest = matches[matches.length - 1]
  return validateProvenanceFields(latest, relPath)
}

function classifyPath(relPath) {
  if (shouldIgnorePath(relPath)) return 'ignore'
  if (isCommentablePath(relPath)) return 'commentable'
  if (isNonCommentableTrackedPath(relPath)) return 'sidecar'
  return 'ignore'
}

function sessionDir(repoRoot) {
  return path.join(repoRoot, SESSION_DIR_REL)
}

function sessionFile(repoRoot, conversationId) {
  const safe = String(conversationId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_')
  return path.join(sessionDir(repoRoot), `${safe}.json`)
}

function loadSession(repoRoot, conversationId) {
  const file = sessionFile(repoRoot, conversationId)
  if (!fs.existsSync(file)) {
    return { files: {}, pending: [] }
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { files: {}, pending: [] }
  }
}

function saveSession(repoRoot, conversationId, data) {
  const dir = sessionDir(repoRoot)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(sessionFile(repoRoot, conversationId), JSON.stringify(data, null, 2))
}

function recordSessionEdit(repoRoot, conversationId, relPath, status) {
  const session = loadSession(repoRoot, conversationId)
  session.files[relPath] = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (status !== 'ok') {
    if (!session.pending.includes(relPath)) session.pending.push(relPath)
  } else {
    session.pending = session.pending.filter((p) => p !== relPath)
  }
  saveSession(repoRoot, conversationId, session)
  return session
}

function findRepoRoot(startDir) {
  let dir = startDir || process.cwd()
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'AGENTS.md'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) return startDir || process.cwd()
    dir = parent
  }
}

module.exports = {
  PROVENANCE_MARKER,
  SIDECAR_REL,
  REQUIRED_FIELDS,
  normalizeRelPath,
  shouldIgnorePath,
  isCommentablePath,
  isNonCommentableTrackedPath,
  extractProvenanceBlock,
  parseProvenanceFields,
  validateProvenanceFields,
  validateCommentableFile,
  validateNonCommentableFile,
  classifyPath,
  recordSessionEdit,
  loadSession,
  saveSession,
  findRepoRoot,
  sessionDir,
}
