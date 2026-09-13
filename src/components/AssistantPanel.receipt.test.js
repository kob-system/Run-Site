// PHOTO RECEIPTS THROUGH THE ASSISTANT.
//
// JP: "drop an image in the chat and be like, 'This is a receipt of whatever
// for this job.' Then it would put it on their job... but of course confirm to
// them what the actual execution task is so it doesn't just mess their
// information up."
//
// So this file holds the three promises that make that safe:
//   1. The card shows the photo, the numbers and the job BEFORE anything saves.
//   2. Nothing is uploaded or saved until Confirm. Cancel leaves nothing behind.
//   3. When the job isn't clear, he has to pick it. No silent guess.

import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import AssistantPanel from './AssistantPanel'

jest.mock('../supabaseClient', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    rpc: jest.fn(),
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}))

// The canvas work can't run in jsdom; the util has its own tests.
jest.mock('../utils/imageToJpeg', () => ({
  toJpeg: jest.fn(),
  imageErrorMessage: (e) => (e && e.message) || 'bad photo',
  jpegName: () => 'IMG_1.jpg',
}))

const OWNER = '11111111-1111-1111-1111-111111111111'
const SMITH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const KLEIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BLOB = { size: 1234, type: 'image/jpeg' }

let upload
let remove

beforeEach(() => {
  // CRA sets resetMocks: true, so every implementation is re-armed here.
  const { supabase } = require('../supabaseClient')
  const { toJpeg } = require('../utils/imageToJpeg')
  toJpeg.mockResolvedValue({ blob: BLOB, base64: 'AAAA', width: 10, height: 10, mediaType: 'image/jpeg' })
  supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't', user: { id: OWNER } } } })
  supabase.rpc.mockResolvedValue({ data: null, error: null })
  const jobs = [
    { id: SMITH, name: 'Smith Deck', stage: 'mid' },
    { id: KLEIN, name: 'Klein Bathroom', stage: 'mid' },
  ]
  supabase.from.mockImplementation(() => ({
    select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: jobs, error: null }) }) }),
  }))
  upload = jest.fn().mockResolvedValue({ error: null })
  remove = jest.fn().mockResolvedValue({ error: null })
  supabase.storage.from.mockReturnValue({ upload, remove })
  URL.createObjectURL = jest.fn(() => 'blob:receipt')
  URL.revokeObjectURL = jest.fn()
  global.fetch = jest.fn(async (url) => {
    if (url === '/api/scan-receipt') {
      return { ok: true, json: async () => ({ store: 'Home Depot', amount: '42.10', tax: '3.37', total: '45.47', date: '2026-09-12' }) }
    }
    if (url === '/api/assistant-execute') {
      return { ok: true, json: async () => ({ message: 'Added a $45.47 materials expense to “Smith Deck”, photo attached.' }) }
    }
    return { ok: true, json: async () => ({ type: 'reply', reply: 'ok' }) }
  })
})

const calls = (url) => global.fetch.mock.calls.filter((c) => c[0] === url)

async function pickPhoto() {
  const input = screen.getByTestId('receipt-file')
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(['x'], 'IMG_1.HEIC', { type: 'image/heic' })] } })
  })
  await screen.findByText(/Home Depot · \$42\.10 before tax/)
}

async function sendNote(text) {
  if (text) fireEvent.change(screen.getByPlaceholderText(/which job/i), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^send$/i })) })
  await screen.findByText(/ABOUT TO ADD THIS RECEIPT/)
}

describe('a receipt photo becomes a confirm card, not a save', () => {
  it('shows the photo, the numbers and the job named in the note, and uploads nothing yet', async () => {
    render(<AssistantPanel open onOpenChange={() => {}} />)
    await pickPhoto()
    await sendNote('receipt for the Smith deck')

    expect(screen.getByLabelText(/which job/i)).toHaveValue(SMITH)
    expect(screen.getByText('$45.47')).toBeInTheDocument()
    expect(screen.getAllByAltText('Receipt photo').length).toBeGreaterThanOrEqual(2) // chat bubble + card
    expect(upload).not.toHaveBeenCalled()
    expect(calls('/api/assistant-execute')).toHaveLength(0)
    // The model never sees it: the card is built from the scan.
    expect(calls('/api/assistant')).toHaveLength(0)
  })

  it('on Confirm uploads the photo first, then saves it on the picked job with photo_path', async () => {
    render(<AssistantPanel open onOpenChange={() => {}} />)
    await pickPhoto()
    await sendNote('receipt for the Smith deck')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^confirm$/i })) })

    await waitFor(() => expect(calls('/api/assistant-execute')).toHaveLength(1))
    const body = JSON.parse(calls('/api/assistant-execute')[0][1].body)
    const { tool, args } = body.actions[0]
    expect(tool).toBe('add_expense')
    expect(args).toMatchObject({
      project_id: SMITH, job_name: 'Smith Deck', amount: 42.1, sales_tax: 3.37,
      store: 'Home Depot', purchase_date: '2026-09-12', category: 'materials',
    })
    // Same folder shape as the manual Add Receipt sheet: <owner uid>/<time>_<name>.
    expect(args.photo_path).toMatch(new RegExp(`^${OWNER}/\\d+_IMG_1\\.jpg$`))
    expect(upload).toHaveBeenCalledWith(args.photo_path, BLOB, { contentType: 'image/jpeg' })
    const execIndex = global.fetch.mock.calls.findIndex((c) => c[0] === '/api/assistant-execute')
    expect(upload.mock.invocationCallOrder[0]).toBeLessThan(global.fetch.mock.invocationCallOrder[execIndex])
    expect(await screen.findByText(/photo attached/)).toBeInTheDocument()
  })

  it('makes him pick the job when nothing points at one', async () => {
    render(<AssistantPanel open onOpenChange={() => {}} />)
    await pickPhoto()
    await sendNote('')

    const picker = screen.getByLabelText(/which job/i)
    expect(picker).toHaveValue('')
    expect(screen.getByText(/pick the job this receipt goes on/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeDisabled()

    fireEvent.change(picker, { target: { value: KLEIN } })
    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeEnabled()
  })

  it('starts on the job he opened the assistant from', async () => {
    render(<AssistantPanel open onOpenChange={() => {}} projectId={KLEIN} />)
    await pickPhoto()
    await sendNote('')
    expect(screen.getByLabelText(/which job/i)).toHaveValue(KLEIN)
  })

  it('Cancel leaves nothing behind', async () => {
    render(<AssistantPanel open onOpenChange={() => {}} />)
    await pickPhoto()
    await sendNote('for the Smith deck')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^cancel$/i })) })

    expect(screen.queryByText(/ABOUT TO ADD THIS RECEIPT/)).not.toBeInTheDocument()
    expect(upload).not.toHaveBeenCalled()
    expect(calls('/api/assistant-execute')).toHaveLength(0)
  })

  it('a failed upload saves nothing and puts the card back for a retry', async () => {
    upload.mockResolvedValueOnce({ error: new Error('offline') })
    render(<AssistantPanel open onOpenChange={() => {}} />)
    await pickPhoto()
    await sendNote('for the Smith deck')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^confirm$/i })) })

    expect(await screen.findByText(/couldn't upload the photo, so nothing was saved/i)).toBeInTheDocument()
    expect(calls('/api/assistant-execute')).toHaveLength(0)
    expect(screen.getByText(/ABOUT TO ADD THIS RECEIPT/)).toBeInTheDocument()
  })

  it('says plainly when the phone cannot open the photo', async () => {
    const { toJpeg } = require('../utils/imageToJpeg')
    toJpeg.mockRejectedValueOnce(Object.assign(
      new Error("This phone couldn't open that photo. Take a new one with the camera, or pick a JPG or PNG."),
      { name: 'ImageDecodeError' }
    ))
    render(<AssistantPanel open onOpenChange={() => {}} />)
    await act(async () => {
      fireEvent.change(screen.getByTestId('receipt-file'), { target: { files: [new File(['x'], 'IMG_1.HEIC', { type: 'image/heic' })] } })
    })
    expect(await screen.findByText(/couldn't open that photo/i)).toBeInTheDocument()
    expect(calls('/api/scan-receipt')).toHaveLength(0)
  })
})

describe('Talk it out knows which job is on screen', () => {
  it('sends the open job id with the message', async () => {
    render(<AssistantPanel open onOpenChange={() => {}} projectId={SMITH} />)
    fireEvent.change(screen.getByPlaceholderText(/or type it/i), { target: { value: 'add 2x4s to the buy list' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^send$/i })) })
    await waitFor(() => expect(calls('/api/assistant')).toHaveLength(1))
    expect(JSON.parse(calls('/api/assistant')[0][1].body).project_id).toBe(SMITH)
  })
})
