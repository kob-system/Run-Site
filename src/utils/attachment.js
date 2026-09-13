// Attachments on an insurance / license item: a photo of the certificate or a
// PDF. Pure helpers so the rules (which files we take, how big, where they
// land in storage) are testable without mounting the dashboard.

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export function isPdf(type, name) {
  return type === 'application/pdf' || /\.pdf$/i.test(name || '')
}

export function isImage(type, name) {
  return /^image\//.test(type || '') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(name || '')
}

// A message the owner can act on, or '' when the file is fine to upload.
export function attachmentProblem(file) {
  if (!file) return 'No file picked. Try again.'
  if (!isImage(file.type, file.name) && !isPdf(file.type, file.name)) return 'That kind of file will not open here. Pick a photo or a PDF.'
  if (!file.size) return 'That file is empty. Pick it again.'
  if (file.size > MAX_ATTACHMENT_BYTES) return 'That file is over 20 MB. Pick a smaller one.'
  return ''
}

// MIME type to store. Some phones hand back an empty type, so fall back on
// the file name.
export function attachmentType(file) {
  if (file && file.type) return file.type
  return file && isPdf('', file.name) ? 'application/pdf' : 'image/jpeg'
}

// `<owner>/compliance/<ms>_<safe name>`. Same shape as job documents
// (`<owner>/docs/...`), so the existing own-folder storage rules cover it.
// The name is cleaned because storage rejects some characters in a key.
export function attachmentPath(ownerId, name, now = Date.now()) {
  const safe = String(name || '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^[_.]+|_+$/g, '')
    .slice(-80) || 'file'
  return `${ownerId}/compliance/${now}_${safe}`
}
