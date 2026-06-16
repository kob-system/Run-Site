// Downloads every file in the private `receipts` storage bucket (the receipt
// photos — which are tax documents) to ./_storage_backup, preserving paths.
// pg_dump does NOT capture storage objects, so this runs alongside it.
//
// Env: SUPABASE_URL (or REACT_APP_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
// Node 18+ (global fetch). Best-effort: logs and continues past a bad object so
// one unreadable file can't abort the whole backup.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = process.env.BACKUP_BUCKET || 'receipts'
const OUT = process.env.BACKUP_OUT || '_storage_backup'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }

// One page of a prefix. Storage returns both files (id != null) and
// sub-"folders" (id == null) that we recurse into.
async function listPrefix(prefix, offset = 0, limit = 100) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit, offset, sortBy: { column: 'name', order: 'asc' } }),
  })
  if (!r.ok) throw new Error(`list ${prefix} -> ${r.status}`)
  return r.json()
}

async function* walk(prefix = '') {
  for (let offset = 0; ; offset += 100) {
    const page = await listPrefix(prefix, offset)
    if (!page.length) break
    for (const entry of page) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null || entry.id === undefined) {
        yield* walk(path) // a sub-folder
      } else {
        yield path // a file
      }
    }
    if (page.length < 100) break
  }
}

async function download(path) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, { headers })
  if (!r.ok) throw new Error(`get ${path} -> ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const dest = join(OUT, BUCKET, path)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, buf)
  return buf.length
}

let files = 0
let bytes = 0
let failed = 0
for await (const path of walk('')) {
  try {
    bytes += await download(path)
    files += 1
  } catch (e) {
    failed += 1
    console.error('skip:', e.message)
  }
}
console.log(`storage backup: ${files} files, ${(bytes / 1e6).toFixed(1)} MB, ${failed} failed`)
if (files === 0 && failed === 0) console.log('(bucket is empty — nothing to back up yet)')
