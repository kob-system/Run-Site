// Every receipt photo goes through here before it is uploaded or scanned.
//
// Why: api/scan-receipt.js only takes JPEG, PNG, WebP or GIF, and an iPhone
// photo picked from the library can arrive as HEIC. A 12 megapixel phone photo
// is also far bigger than a receipt needs, which makes the upload slow on a
// jobsite signal. So the picked file is decoded by the browser, shrunk to at
// most 1600px on its long side, and re-encoded as a JPEG on a canvas. Both the
// manual Add Receipt sheet and the assistant use this, so the two paths always
// store and scan the same kind of file.
//
// If the browser cannot open the file at all (HEIC on a desktop Chrome, a PDF,
// a corrupt file) the caller gets an ImageDecodeError whose message is written
// for the person holding the phone, never a silent nothing.

export const MAX_SIDE = 1600
export const JPEG_QUALITY = 0.85
export const DECODE_FAIL_MSG = "This phone couldn't open that photo. Take a new one with the camera, or pick a JPG or PNG."
export const NOT_IMAGE_MSG = "That file isn't a photo. Pick a picture of the receipt."

export class ImageDecodeError extends Error {
  constructor(message) {
    super(message || DECODE_FAIL_MSG)
    this.name = 'ImageDecodeError'
  }
}

// Plain-English message for any failure out of toJpeg().
export function imageErrorMessage(err) {
  return err && err.name === 'ImageDecodeError' && err.message ? err.message : DECODE_FAIL_MSG
}

// Scale (w, h) so the long side is at most `max`. Never scales UP.
export function fitWithin(w, h, max = MAX_SIDE) {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 }
  const long = Math.max(w, h)
  if (long <= max) return { width: Math.round(w), height: Math.round(h) }
  const s = max / long
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

// Some pickers (and desktop browsers handed a HEIC) give no MIME type at all,
// so fall back to the file extension before calling it "not a photo".
export function looksLikeImage(file) {
  if (!file) return false
  const t = String(file.type || '').toLowerCase()
  if (t.startsWith('image/')) return true
  if (t) return false
  return /\.(heic|heif|jpe?g|png|webp|gif|bmp|tiff?|avif)$/i.test(String(file.name || ''))
}

// "IMG_1234.HEIC" -> "IMG_1234.jpg". Storage keys stay plain ASCII.
export function jpegName(name) {
  const base = String(name || '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
  return `${base || 'receipt'}.jpg`
}

function decodeWithImg(file) {
  return new Promise((resolve, reject) => {
    let url
    try { url = URL.createObjectURL(file) } catch { reject(new ImageDecodeError(DECODE_FAIL_MSG)); return }
    const img = new Image()
    // A browser that can't decode the format sometimes never fires either
    // event. Twenty seconds is far past any real decode.
    const timer = setTimeout(() => { cleanup(); reject(new ImageDecodeError(DECODE_FAIL_MSG)) }, 20000)
    const cleanup = () => { clearTimeout(timer); try { URL.revokeObjectURL(url) } catch { /* already gone */ } }
    img.onload = () => {
      const width = img.naturalWidth || img.width
      const height = img.naturalHeight || img.height
      if (!width || !height) { cleanup(); reject(new ImageDecodeError(DECODE_FAIL_MSG)); return }
      resolve({ source: img, width, height, done: cleanup })
    }
    img.onerror = () => { cleanup(); reject(new ImageDecodeError(DECODE_FAIL_MSG)) }
    img.src = url
  })
}

async function decode(file) {
  // createImageBitmap honours the EXIF rotation and skips the <img> dance.
  // Older Safari has it without the options bag, or not at all, so any throw
  // falls back to a plain <img>, which every browser has.
  if (typeof window !== 'undefined' && typeof window.createImageBitmap === 'function') {
    try {
      const bmp = await window.createImageBitmap(file, { imageOrientation: 'from-image' })
      if (bmp && bmp.width && bmp.height) {
        return { source: bmp, width: bmp.width, height: bmp.height, done: () => { try { bmp.close() } catch { /* fine */ } } }
      }
    } catch { /* fall through to <img> */ }
  }
  return decodeWithImg(file)
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new ImageDecodeError(DECODE_FAIL_MSG))
    r.readAsDataURL(blob)
  })
}

// file -> { blob, base64, width, height, mediaType: 'image/jpeg' }
export async function toJpeg(file, { maxSide = MAX_SIDE, quality = JPEG_QUALITY } = {}) {
  if (!looksLikeImage(file)) throw new ImageDecodeError(NOT_IMAGE_MSG)
  const img = await decode(file)
  try {
    const { width, height } = fitWithin(img.width, img.height, maxSide)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext && canvas.getContext('2d')
    if (!ctx || !width || !height) throw new ImageDecodeError(DECODE_FAIL_MSG)
    // JPEG has no transparency; a see-through PNG would otherwise go black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img.source, 0, 0, width, height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || !blob.size) throw new ImageDecodeError(DECODE_FAIL_MSG)
    const base64 = await blobToBase64(blob)
    if (!base64) throw new ImageDecodeError(DECODE_FAIL_MSG)
    return { blob, base64, width, height, mediaType: 'image/jpeg' }
  } finally {
    img.done()
  }
}
