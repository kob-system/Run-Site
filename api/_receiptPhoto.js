// Guard for the receipt photo path the assistant's confirm card hands to
// api/assistant-execute.js. The browser uploads the photo to the private
// `receipts` bucket (only after Confirm) and sends back the storage PATH; this
// checks it points inside the caller's own tenant folder before it is written
// to receipts.photo_url, so nobody can attach a path from another account.
//
//   owner: <owner uid>/<file>             same shape the manual Add Receipt uses
//   crew:  <boss uid>/receipts/<file>     the storage insert policy lets an
//                                          assigned worker write into the boss's
//                                          folder; the boss reads it back with
//                                          the normal own-folder policy.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const SHAPE = new RegExp(`^${UUID}/[A-Za-z0-9._/-]{1,200}$`, 'i')

export function receiptPhotoFolder({ isWorker, uid, ownerId }) {
  return isWorker ? `${ownerId}/receipts/` : `${uid}/`
}

// true when `path` is a safe storage key inside `folder`.
export function isAllowedReceiptPhotoPath(path, folder) {
  if (typeof path !== 'string' || typeof folder !== 'string' || !folder) return false
  if (!SHAPE.test(path)) return false
  if (path.includes('..') || path.includes('//')) return false
  if (!path.startsWith(folder)) return false
  return path.length > folder.length
}
