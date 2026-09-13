import { isPdf, isImage, attachmentProblem, attachmentType, attachmentPath, MAX_ATTACHMENT_BYTES } from './attachment'

const file = (name, type, size = 1000) => ({ name, type, size })

describe('attachment helpers', () => {
  it('knows a photo from a PDF, by type or by name', () => {
    expect(isImage('image/jpeg', 'x')).toBe(true)
    expect(isImage('', 'IMG_2231.HEIC')).toBe(true)
    expect(isImage('application/pdf', 'coi.pdf')).toBe(false)
    expect(isPdf('application/pdf', 'x')).toBe(true)
    expect(isPdf('', 'COI 2026.PDF')).toBe(true)
    expect(isPdf('image/png', 'a.png')).toBe(false)
  })

  it('takes photos and PDFs, turns away everything else with a plain reason', () => {
    expect(attachmentProblem(file('coi.pdf', 'application/pdf'))).toBe('')
    expect(attachmentProblem(file('image.jpg', 'image/jpeg'))).toBe('')
    expect(attachmentProblem(file('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toMatch(/photo or a PDF/)
    expect(attachmentProblem(file('big.pdf', 'application/pdf', MAX_ATTACHMENT_BYTES + 1))).toMatch(/20 MB/)
    expect(attachmentProblem(file('empty.pdf', 'application/pdf', 0))).toMatch(/empty/)
    expect(attachmentProblem(null)).toMatch(/No file/)
  })

  it('fills in a type when the phone leaves it blank', () => {
    expect(attachmentType(file('a.pdf', ''))).toBe('application/pdf')
    expect(attachmentType(file('a.jpg', ''))).toBe('image/jpeg')
    expect(attachmentType(file('a.png', 'image/png'))).toBe('image/png')
  })

  it('lands in the owner folder, so the existing storage rules cover it', () => {
    const p = attachmentPath('owner-1', 'GL cert (2026) #4.pdf', 123)
    expect(p).toBe('owner-1/compliance/123_GL_cert_2026_4.pdf')
    expect(p.split('/')[0]).toBe('owner-1')
    expect(attachmentPath('owner-1', '', 5)).toBe('owner-1/compliance/5_file')
    expect(attachmentPath('owner-1', '../../etc', 5)).toBe('owner-1/compliance/5_etc')
  })
})
