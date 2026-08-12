/**
 * Shared helpers for atlas-agent-provenance/v1 enforcement.
 * Includes plan binding (sprint 502): reject plan_id none when a plan is known.
 */

/**
 * Shared helpers for atlas-agent-provenance/v1 enforcement.
 * Used by check-agent-provenance.cjs, provenance-hunks.cjs, and Cursor hooks.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const os = require('os')

const PROVENANCE_MARKER = 'atlas-agent-provenance/v1'
const SIDECAR_REL = path.join('.cursor', 'agent-provenance.jsonl')
const SESSION_DIR_REL = path.join('.cursor', '.provenance-session')
const SPRINT_DIR_REL = path.join('.cursor', 'markdown-working-roadmap')

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

const PLAN_BIND_FIELDS = [
  'plan_id',
  'plan_path',
  'plan_revision',
  'planner_model',
  'planner_model_id',
  'planner_reasoning',
  'planner_max_mode',
  'planner_context_window',
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

function hasIgnoredSegment(relPath) {
  return String(relPath).split('/').includes('node_modules')
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

function isPlanNone(value) {
  return !value || /^none$/i.test(String(value).trim())
}

function isRealPlanId(value) {
  return Boolean(value) && !isPlanNone(value)
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text || '').replace(/\r\n/g, '\n')).digest('hex')
}

/**
 * Parse "## Plan provenance" stanza from a sprint markdown body.
 * Accepts "- plan_id: foo" or "plan_id: foo" (with optional backticks).
 */
function parseSprintPlanProvenance(content) {
  if (!content) return null
  const lines = String(content).replace(/\r\n/g, '\n').split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,3}\s*Plan provenance\s*$/i.test(lines[i].trim())) {
      start = i + 1
      break
    }
  }
  if (start === -1) return null

  const fields = {}
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]
    if (/^#{1,3}\s+/.test(raw)) break
    const cleaned = raw.replace(/^\s*[-*]\s*/, '').trim()
    if (!cleaned) continue
    const m = cleaned.match(/^([a-z_]+)\s*:\s*(.+)$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    let value = m[2].trim()
    value = value.replace(/^`(.+)`$/, '$1').trim()
    if (!fields[key]) fields[key] = value
  }

  if (!isRealPlanId(fields.plan_id)) return null
  return normalizeActivePlan(fields)
}

function normalizeActivePlan(partial) {
  if (!partial || !isRealPlanId(partial.plan_id)) return null
  const plan = {
    plan_id: String(partial.plan_id).trim(),
    plan_path: String(partial.plan_path || 'none').trim(),
    plan_revision: String(partial.plan_revision || 'none').trim(),
    planner_model: String(partial.planner_model || 'not_exposed').trim(),
    planner_model_id: String(partial.planner_model_id || 'not_exposed').trim(),
    planner_reasoning: String(partial.planner_reasoning || 'not_exposed').trim(),
    planner_max_mode: String(partial.planner_max_mode || 'not_exposed').trim(),
    planner_context_window: String(partial.planner_context_window || 'not_exposed').trim(),
  }
  return plan
}

function planIdFromCursorPlanName(nameOrPath) {
  const base = path.basename(String(nameOrPath || ''), '.plan.md')
  // strip trailing _<hex> salt when present
  const withoutSalt = base.replace(/_[0-9a-f]{6,}$/i, '')
  return withoutSalt
    .replace(/_/g, '-')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function isSprintMarkdownRel(relPath) {
  if (!relPath) return false
  const n = normalizeRelPath(relPath)
  return (
    n.startsWith('.cursor/markdown-working-roadmap/') &&
    /SPRINT\.md$/i.test(n)
  )
}

function isCursorPlanPath(filePath) {
  if (!filePath) return false
  const n = String(filePath).replace(/\\/g, '/')
  return n.includes('/.cursor/plans/') && n.endsWith('.plan.md')
}

function activePlanFromSprintFile(absPath, relPath) {
  let content
  try {
    content = fs.readFileSync(absPath, 'utf8')
  } catch {
    return null
  }
  const plan = parseSprintPlanProvenance(content)
  if (!plan) return null
  if (isPlanNone(plan.plan_path) && relPath) {
    plan.plan_path = normalizeRelPath(relPath)
  }
  return plan
}

function activePlanFromCursorPlanFile(absPath, preferredPlanPath) {
  let content
  try {
    content = fs.readFileSync(absPath, 'utf8')
  } catch {
    return null
  }
  const plan_id = planIdFromCursorPlanName(absPath)
  if (!plan_id) return null
  // Prefer plan body hash after YAML frontmatter when present
  let body = content.replace(/\r\n/g, '\n')
  const fm = body.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)
  if (fm) body = fm[1].replace(/^\n+/, '')
  return normalizeActivePlan({
    plan_id,
    plan_path: preferredPlanPath || absPath,
    plan_revision: sha256Text(body),
    planner_model: 'not_exposed',
    planner_model_id: 'not_exposed',
    planner_reasoning: 'not_exposed',
    planner_max_mode: 'not_exposed',
    planner_context_window: 'not_exposed',
  })
}

function formatActivePlanStanza(plan) {
  if (!plan || !isRealPlanId(plan.plan_id)) return ''
  return [
    'ACTIVE PLAN (copy these exact fields into every atlas-agent-provenance/v1 record):',
    `plan_id: ${plan.plan_id}`,
    `plan_path: ${plan.plan_path}`,
    `plan_revision: ${plan.plan_revision}`,
    `planner_model: ${plan.planner_model}`,
    `planner_model_id: ${plan.planner_model_id}`,
    `planner_reasoning: ${plan.planner_reasoning}`,
    `planner_max_mode: ${plan.planner_max_mode}`,
    `planner_context_window: ${plan.planner_context_window}`,
    'Do NOT use plan_id: none while this plan is bound.',
  ].join('\n')
}

function validateAgainstActivePlan(fields, activePlan) {
  const errors = []
  if (!activePlan || !isRealPlanId(activePlan.plan_id)) return errors
  if (!fields) return errors

  if (isPlanNone(fields.plan_id)) {
    errors.push(
      `plan_id: none is invalid — session has active plan "${activePlan.plan_id}" (copy plan fields from that plan)`
    )
    return errors
  }
  if (fields.plan_id !== activePlan.plan_id) {
    errors.push(
      `plan_id "${fields.plan_id}" does not match active plan "${activePlan.plan_id}"`
    )
  }
  if (
    !isPlanNone(activePlan.plan_path) &&
    fields.plan_path &&
    fields.plan_path !== activePlan.plan_path &&
    !isPlanNone(fields.plan_path)
  ) {
    errors.push(
      `plan_path "${fields.plan_path}" does not match active plan "${activePlan.plan_path}"`
    )
  }
  if (
    !isPlanNone(activePlan.plan_revision) &&
    fields.plan_revision &&
    fields.plan_revision !== activePlan.plan_revision &&
    !isPlanNone(fields.plan_revision)
  ) {
    errors.push(
      `plan_revision does not match active plan revision`
    )
  }
  return errors
}

function validateProvenanceFields(fields, relPath, options = {}) {
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
    errors.push(`file field "${fields.file}" does not match path "${relPath}"`)
  }
  if (options.activePlan) {
    errors.push(...validateAgainstActivePlan(fields, options.activePlan))
  }
  return errors
}

function readProvenanceFieldsFromFile(absPath, relPath) {
  let content
  try {
    content = fs.readFileSync(absPath, 'utf8')
  } catch (err) {
    return { fields: null, errors: [`unreadable: ${err.message}`] }
  }
  const head = content.slice(0, 12000)
  const block = extractProvenanceBlock(head) || extractProvenanceBlock(content)
  if (!block) {
    return {
      fields: null,
      errors: [
        'missing in-file atlas-agent-provenance/v1 header (sidecar is NOT allowed for commentable files)',
      ],
    }
  }
  return { fields: parseProvenanceFields(block), errors: [] }
}

function validateCommentableFile(absPath, relPath, options = {}) {
  const { fields, errors: readErrors } = readProvenanceFieldsFromFile(absPath, relPath)
  if (readErrors.length) return readErrors
  return validateProvenanceFields(fields, relPath, options)
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

function validateNonCommentableFile(repoRoot, relPath, options = {}) {
  const entries = readSidecarEntries(repoRoot)
  const matches = entries.filter((e) => normalizeRelPath(e.file) === normalizeRelPath(relPath))
  if (matches.length === 0) {
    return [
      `missing sidecar line in ${SIDECAR_REL} for non-commentable file (in-file comments not allowed)`,
    ]
  }
  const latest = matches[matches.length - 1]
  return validateProvenanceFields(latest, relPath, options)
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
    return { files: {}, pending: [], active_plan: null }
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!data.files) data.files = {}
    if (!data.pending) data.pending = []
    if (data.active_plan === undefined) data.active_plan = null
    return data
  } catch {
    return { files: {}, pending: [], active_plan: null }
  }
}

function saveSession(repoRoot, conversationId, data) {
  const dir = sessionDir(repoRoot)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(sessionFile(repoRoot, conversationId), JSON.stringify(data, null, 2))
}

function setSessionActivePlan(repoRoot, conversationId, plan) {
  const session = loadSession(repoRoot, conversationId)
  const normalized = normalizeActivePlan(plan)
  if (!normalized) return session
  session.active_plan = normalized
  session.active_plan_bound_at = new Date().toISOString()
  saveSession(repoRoot, conversationId, session)
  return session
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

/**
 * If an edited path is a sprint doc or Cursor plan, bind active_plan onto the session.
 * Sprint docs win over ephemeral .plan.md when both are available.
 */
function maybeBindPlanFromEditedPath(repoRoot, conversationId, filePath) {
  if (!filePath) return null
  const abs = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath)
  const rel = normalizeRelPath(abs, repoRoot)

  if (isSprintMarkdownRel(rel) && fs.existsSync(abs)) {
    const plan = activePlanFromSprintFile(abs, rel)
    if (plan) {
      setSessionActivePlan(repoRoot, conversationId, plan)
      return plan
    }
  }

  if (isCursorPlanPath(abs) && fs.existsSync(abs)) {
    // Prefer an existing durable sprint path if session already has one for same id
    const session = loadSession(repoRoot, conversationId)
    const preferred =
      session.active_plan && session.active_plan.plan_path && !isPlanNone(session.active_plan.plan_path)
        ? session.active_plan.plan_path
        : abs
    const plan = activePlanFromCursorPlanFile(abs, preferred.startsWith('.cursor/') ? preferred : abs)
    if (plan) {
      // If a matching sprint doc already exists in repo with same plan_id, prefer its plan_path
      const sprintPlan = findSprintPlanById(repoRoot, plan.plan_id)
      if (sprintPlan) {
        setSessionActivePlan(repoRoot, conversationId, sprintPlan)
        return sprintPlan
      }
      setSessionActivePlan(repoRoot, conversationId, plan)
      return plan
    }
  }

  return null
}

function findSprintPlanById(repoRoot, planId) {
  if (!isRealPlanId(planId)) return null
  const dir = path.join(repoRoot, SPRINT_DIR_REL)
  if (!fs.existsSync(dir)) return null
  let names
  try {
    names = fs.readdirSync(dir).filter((n) => /SPRINT\.md$/i.test(n))
  } catch {
    return null
  }
  for (const name of names) {
    const rel = path.join(SPRINT_DIR_REL, name).replace(/\\/g, '/')
    const abs = path.join(repoRoot, rel)
    const plan = activePlanFromSprintFile(abs, rel)
    if (plan && plan.plan_id === planId) return plan
  }
  return null
}

/**
 * Bind from postToolUse / CreatePlan tool payloads.
 */
function maybeBindPlanFromToolPayload(repoRoot, conversationId, payload) {
  if (!payload) return null
  const tool = String(payload.tool_name || '')
  const input = payload.tool_input || {}

  const candidates = []
  if (input.path) candidates.push(input.path)
  if (input.file_path) candidates.push(input.file_path)
  if (input.target_notebook) candidates.push(input.target_notebook)
  if (Array.isArray(input.paths)) candidates.push(...input.paths)

  // CreatePlan may expose plan path under various keys
  if (/CreatePlan/i.test(tool)) {
    if (input.planPath) candidates.push(input.planPath)
    if (input.plan_path) candidates.push(input.plan_path)
    if (payload.tool_output) {
      try {
        const out =
          typeof payload.tool_output === 'string'
            ? JSON.parse(payload.tool_output)
            : payload.tool_output
        if (out && out.planPath) candidates.push(out.planPath)
        if (out && out.plan_path) candidates.push(out.plan_path)
        if (out && out.uri) candidates.push(out.uri)
      } catch {
        // tool_output may be plain text containing a path
        const m = String(payload.tool_output).match(/[^\s"']+\.plan\.md/)
        if (m) candidates.push(m[0])
      }
    }
  }

  let bound = null
  for (const c of candidates) {
    if (!c) continue
    const plan = maybeBindPlanFromEditedPath(repoRoot, conversationId, c)
    if (plan) bound = plan
  }
  return bound
}

/**
 * Bind from beforeSubmitPrompt attachments (sprint docs or .plan.md).
 */
function maybeBindPlanFromPromptAttachments(repoRoot, conversationId, attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return null
  let bound = null
  for (const att of attachments) {
    const fp = att && (att.file_path || att.path)
    if (!fp) continue
    const plan = maybeBindPlanFromEditedPath(repoRoot, conversationId, fp)
    if (plan) bound = plan
  }
  return bound
}

/**
 * From a commit/CI file set: if any *SPRINT.md has a real plan_id, return that plan.
 * Prefers the highest-numbered sprint when multiple exist.
 */
function extractPlanFromCommitSet(repoRoot, files) {
  const sprintRels = (files || [])
    .map((f) => normalizeRelPath(f, repoRoot))
    .filter((f) => isSprintMarkdownRel(f))
    .sort()

  let best = null
  let bestNum = -1
  for (const rel of sprintRels) {
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs)) continue
    const plan = activePlanFromSprintFile(abs, rel)
    if (!plan) continue
    const m = path.basename(rel).match(/^(\d+)/)
    const num = m ? Number(m[1]) : 0
    if (!best || num >= bestNum) {
      best = plan
      bestNum = num
    }
  }
  return best
}

/**
 * Commit/CI heuristic: when the file set includes a sprint with a real plan,
 * every other provenance record with plan_id: none fails.
 */
function validateCommitSetPlanConsistency(repoRoot, files) {
  const failures = []
  const activePlan = extractPlanFromCommitSet(repoRoot, files)
  if (!activePlan) return failures

  for (const rel of files || []) {
    const n = normalizeRelPath(rel, repoRoot)
    if (!n || shouldIgnorePath(n)) continue
    // The sprint doc that defines the plan may itself be in the set — skip if it matches
    if (isSprintMarkdownRel(n)) {
      const abs = path.join(repoRoot, n)
      const sprintPlan = fs.existsSync(abs) ? activePlanFromSprintFile(abs, n) : null
      if (sprintPlan && sprintPlan.plan_id === activePlan.plan_id) continue
    }

    const kind = classifyPath(n)
    if (kind === 'ignore') continue
    const abs = path.join(repoRoot, n)
    if (!fs.existsSync(abs)) continue

    let fields = null
    if (kind === 'commentable') {
      const read = readProvenanceFieldsFromFile(abs, n)
      fields = read.fields
    } else if (kind === 'sidecar') {
      const entries = readSidecarEntries(repoRoot).filter(
        (e) => normalizeRelPath(e.file) === n
      )
      if (entries.length) fields = entries[entries.length - 1]
    }
    if (!fields) continue
    if (isPlanNone(fields.plan_id)) {
      failures.push({
        file: n,
        kind,
        errors: [
          `plan_id: none is invalid — commit set includes sprint plan "${activePlan.plan_id}" (${activePlan.plan_path})`,
        ],
      })
    }
  }
  return failures
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
  PLAN_BIND_FIELDS,
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
  isPlanNone,
  isRealPlanId,
  sha256Text,
  parseSprintPlanProvenance,
  planIdFromCursorPlanName,
  isSprintMarkdownRel,
  isCursorPlanPath,
  activePlanFromSprintFile,
  activePlanFromCursorPlanFile,
  formatActivePlanStanza,
  validateAgainstActivePlan,
  setSessionActivePlan,
  maybeBindPlanFromEditedPath,
  maybeBindPlanFromToolPayload,
  maybeBindPlanFromPromptAttachments,
  findSprintPlanById,
  extractPlanFromCommitSet,
  validateCommitSetPlanConsistency,
  readProvenanceFieldsFromFile,
  readSidecarEntries,
  normalizeActivePlan,
}
