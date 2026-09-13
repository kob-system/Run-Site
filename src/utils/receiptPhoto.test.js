// The assistant's receipt card sends a storage path to assistant-execute. It
// must only ever point inside the caller's own tenant folder.
import { isAllowedReceiptPhotoPath, receiptPhotoFolder } from '../../api/_receiptPhoto'

const OWNER = '11111111-1111-1111-1111-111111111111'
const BOSS = '22222222-2222-2222-2222-222222222222'

describe('owner receipt photo paths', () => {
  const folder = receiptPhotoFolder({ isWorker: false, uid: OWNER, ownerId: null })
  it('is the same folder the manual Add Receipt uses', () => {
    expect(folder).toBe(`${OWNER}/`)
  })
  it('accepts a photo in his own folder', () => {
    expect(isAllowedReceiptPhotoPath(`${OWNER}/1726000000000_receipt.jpg`, folder)).toBe(true)
  })
  it('refuses another account, a climb out, and junk', () => {
    expect(isAllowedReceiptPhotoPath(`${BOSS}/1726000000000_receipt.jpg`, folder)).toBe(false)
    expect(isAllowedReceiptPhotoPath(`${OWNER}/../${BOSS}/x.jpg`, folder)).toBe(false)
    expect(isAllowedReceiptPhotoPath(`${OWNER}/`, folder)).toBe(false)
    expect(isAllowedReceiptPhotoPath(`${OWNER}/my receipt.jpg`, folder)).toBe(false)
    expect(isAllowedReceiptPhotoPath('https://example.com/x.jpg', folder)).toBe(false)
    expect(isAllowedReceiptPhotoPath(null, folder)).toBe(false)
  })
})

describe('crew receipt photo paths', () => {
  const folder = receiptPhotoFolder({ isWorker: true, uid: 'worker', ownerId: BOSS })
  it('goes in the boss folder under receipts/', () => {
    expect(folder).toBe(`${BOSS}/receipts/`)
    expect(isAllowedReceiptPhotoPath(`${BOSS}/receipts/1726000000000_receipt.jpg`, folder)).toBe(true)
  })
  it('cannot land anywhere else in the boss folder', () => {
    expect(isAllowedReceiptPhotoPath(`${BOSS}/1726000000000_receipt.jpg`, folder)).toBe(false)
    expect(isAllowedReceiptPhotoPath(`${BOSS}/jobphotos/x.jpg`, folder)).toBe(false)
  })
})
