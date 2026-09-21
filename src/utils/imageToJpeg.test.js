import {
  fitWithin, looksLikeImage, jpegName, toJpeg, imageErrorMessage,
  MAX_SIDE, DECODE_FAIL_MSG, NOT_IMAGE_MSG,
} from './imageToJpeg'

describe('fitWithin: long side capped at 1600, never scaled up', () => {
  it('shrinks a 12MP landscape photo', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 })
  })
  it('shrinks a portrait photo on its long side', () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 })
  })
  it('leaves a small image alone', () => {
    expect(fitWithin(1000, 800)).toEqual({ width: 1000, height: 800 })
  })
  it('uses 1600 as the default', () => {
    expect(MAX_SIDE).toBe(1600)
  })
  it('returns zeros for a broken size', () => {
    expect(fitWithin(0, 10)).toEqual({ width: 0, height: 0 })
    expect(fitWithin(NaN, 10)).toEqual({ width: 0, height: 0 })
  })
})

describe('looksLikeImage', () => {
  it('accepts any image type, HEIC included', () => {
    expect(looksLikeImage({ type: 'image/heic', name: 'IMG_1.HEIC' })).toBe(true)
    expect(looksLikeImage({ type: 'image/jpeg', name: 'a.jpg' })).toBe(true)
  })
  it('falls back to the extension when the picker gives no type', () => {
    expect(looksLikeImage({ type: '', name: 'IMG_1.HEIC' })).toBe(true)
    expect(looksLikeImage({ type: '', name: 'notes.txt' })).toBe(false)
  })
  it('rejects a PDF and nothing', () => {
    expect(looksLikeImage({ type: 'application/pdf', name: 'r.pdf' })).toBe(false)
    expect(looksLikeImage(null)).toBe(false)
  })
})

describe('jpegName', () => {
  it('swaps the extension for .jpg and keeps the key plain', () => {
    expect(jpegName('IMG_1234.HEIC')).toBe('IMG_1234.jpg')
    expect(jpegName('my photo (1).png')).toBe('my_photo_1.jpg')
    expect(jpegName('')).toBe('receipt.jpg')
  })
})

describe('toJpeg says so plainly when it cannot open the file', () => {
  const realImage = window.Image
  const realCreate = URL.createObjectURL
  const realRevoke = URL.revokeObjectURL
  afterEach(() => {
    window.Image = realImage
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
  })

  it('refuses a file that is not a photo', async () => {
    await expect(toJpeg({ type: 'application/pdf', name: 'r.pdf' }))
      .rejects.toMatchObject({ name: 'ImageDecodeError', message: NOT_IMAGE_MSG })
  })

  it('turns a decode failure (HEIC on a browser that cannot read it) into a clear message', async () => {
    URL.createObjectURL = jest.fn(() => 'blob:fake')
    URL.revokeObjectURL = jest.fn()
    window.Image = class {
      set src(_v) { setTimeout(() => this.onerror && this.onerror(new Event('error')), 0) }
    }
    await expect(toJpeg({ type: 'image/heic', name: 'IMG_1.HEIC' }))
      .rejects.toMatchObject({ name: 'ImageDecodeError', message: DECODE_FAIL_MSG })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('imageErrorMessage never returns a blank or a stack trace', () => {
    expect(imageErrorMessage(new Error('canvas exploded'))).toBe(DECODE_FAIL_MSG)
    expect(imageErrorMessage(undefined)).toBe(DECODE_FAIL_MSG)
  })
})
