import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { formatCurrency } from '../utils/formatCurrency'
import { formatTime } from '../utils/formatTime'
import { todayLocal } from '../utils/todayLocal'
import { computeProfit, computeMargin, computeContractPrice, roundCents } from '../utils/money'
import { downloadCsv } from '../utils/csv'
import AssistantPanel from '../components/AssistantPanel'
import InstallPrompt from '../components/InstallPrompt'
import { buildQboInvoicesCsv, buildQboCustomersCsv } from '../features/quickbooks'
import { deleteSampleJob } from '../utils/sampleJob'
import { track, EV } from '../utils/analytics'
import { legacyFreeDaysLeft, canStartJob } from '../utils/trialWindow'
import {
  itemAmount, subtotal, taxableBase, taxAmount, estimateTotal,
  normalizeTaxMode, TAX_MODES, DEFAULT_TAX_MODE
} from '../utils/estimateMath'

// Deduction categories an accountant wants broken out at tax time.
const RECEIPT_CATEGORIES = ['materials', 'fuel', 'tools', 'permits', 'subcontractor', 'supplies', 'insurance', 'meals', 'other']
const CATEGORY_LABELS = {
  materials: 'Materials', fuel: 'Fuel / Gas', tools: 'Tools', permits: 'Permits',
  subcontractor: 'Subcontractor', supplies: 'Supplies', insurance: 'Insurance', meals: 'Meals', other: 'Other'
}
const DEFAULT_MILEAGE_RATE = 0.70 // IRS standard business mileage rate — edit per trip to the current year's rate

// Today as YYYY-MM-DD in the OWNER's timezone. new Date().toISOString() is UTC,
// which after ~8pm Eastern stamps tomorrow's date on tonight's receipt — and on
// Dec 31 that files a deduction in the wrong tax year.
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The job screen used to stack THREE rows of navigation before any content: 3
// quick buttons, then 4 lifecycle buckets, then the tabs inside the open
// bucket — 12 destinations, one small panel at a time. Crowded at the top,
// empty at the bottom, and whatever you wanted was two taps behind a bucket
// name you had to guess.
//
// Now it's ONE row of four tabs, and each tab stacks its sections down the page
// (collapsible, each with a count) — the pattern Square, Notion, and iOS
// Settings all landed on: one axis of navigation, then scroll.
// Every table that holds something the owner put in, in the order a person
// would look for it. Add a table here the day you add one to the app —
// an export that misses a section is the one thing worse than no export.
const EXPORT_TABLES = [
  ['projects', 'Jobs'],
  ['receipts', 'Receipts'],
  ['time_entries', 'Crew hours'],
  ['mileage_entries', 'Mileage'],
  ['estimates', 'Estimates'],
  ['invoices', 'Invoices'],
  ['change_orders', 'Extras & change orders'],
  ['schedule_entries', 'Schedule'],
  ['daily_logs', 'Daily notes'],
  ['job_photos', 'Photos'],
  ['job_documents', 'Documents'],
  ['permits', 'Permits & inspections'],
  ['material_items', 'Shopping lists'],
  ['punch_items', 'Fix-it lists'],
  ['warranties', 'Callbacks & warranty work'],
  ['compliance_items', 'Insurance & licenses'],
  ['time_off_requests', 'Time off'],
  ['paychecks', 'Crew pay'],
  ['project_workers', 'Who was on which job'],
  ['worker_invites', 'Crew invites'],
  ['profiles', 'People (you and your crew)'],
  // The assistant's own audit trail — every change it made for them, and who
  // asked for it. Both of its policies are self-scoped (owner_scope or
  // actor_id = auth.uid()), so a plain select is already their rows only.
  ['assistant_actions', 'Things the assistant did for you'],
  // ⚠️ THE ONE TABLE THAT NEEDS ITS OWN FILTER, and the reason the blanket
  // "RLS already scopes this" rule below is not quite universal.
  // testimonials carries a deliberate second SELECT policy —
  // `testimonials_select_approved: using (approved = true)`, granted to
  // authenticated as well as anon, so the marketing site can show quotes. That
  // means a plain `select *` here returns every APPROVED testimonial from every
  // other JobTally customer, and they'd land in this owner's "everything on
  // your account" file with other contractors' names attached. The explicit
  // owner_id filter is not redundant belt-and-braces — it is load-bearing.
  ['testimonials', 'Your review', 'owner_id'],
]
const PROJECT_TABS = [
  { key: 'work', label: 'Work' },
  { key: 'plan', label: 'Plan' },
  { key: 'money', label: 'Money' },
  { key: 'docs', label: 'Docs' },
]
// Plain-English names for the DB stage values (start/mid/end). The raw values
// mean nothing to a contractor — always render through this map.
const STAGE_LABELS = { start: 'Not started', mid: 'In progress', end: 'Done' }
const stageLabel = (s) => STAGE_LABELS[s] || s
// What tapping the stage control actually DOES, spelled out. This used to be a
// bare "Not started ↻" pill in the top-right corner of the job header, and the
// owner's own words on seeing it were "a not started button on the top right
// hand corner which I don't know what that is."
const STAGE_ACTION = { start: 'Start work →', mid: 'Mark done ✓', end: '↩ Reopen job' }

// Estimate line-item math lives in utils/estimateMath.js so it can be tested —
// it used to be three one-liners here, and one of them taxed labor. Short
// aliases keep the call sites below reading the way they always have.
const ESTIMATE_KINDS = [['materials', 'Materials'], ['labor', 'Labor'], ['other', 'Other']]
const estItemAmount = itemAmount
const estSubtotal = subtotal
const btnSm = (bg) => ({ background: bg, color: 'white', border: 'none', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', minHeight: '44px' })
const btnSmOutline = () => ({ background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', minHeight: '44px' })
const sectionLabel = { fontSize: '11px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '1px', margin: '18px 0 8px', padding: '0 4px' }

// Revamped nav helpers: a big tappable menu row (hub card) and a back-to-hub link.
// Which bottom-nav bucket "owns" each content key (drives the highlight below).
const NAV_BUCKET = {
  home: 'home',
  jobs: 'jobs', calendar: 'jobs',
  money: 'money', estimates: 'money', invoices: 'money', clients: 'money', insights: 'money', reports: 'money',
  crew: 'crew', workers: 'crew', payroll: 'crew', crewweek: 'crew',
  // "More" lost its nav slot to Ask and now hangs off Home, so everything
  // inside it lights Home instead of a button that no longer exists.
  more: 'home', compliance: 'home', warranties: 'home', settings: 'home',
}
const HubCard = ({ icon, title, sub, onClick }) => (
  <div className="card" role="button" tabIndex={0} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 'var(--tap)' }} onClick={onClick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}>
    <div><h3>{icon ? icon + ' ' : ''}{title}</h3><p>{sub}</p></div>
    <span style={{ color: '#888', fontSize: '22px' }}>›</span>
  </div>
)
const BackBtn = ({ label, onClick }) => (
  <button onClick={onClick} style={{ background: 'none', border: 'none', color: '#E07B2A', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '8px', padding: '4px' }}>‹ {label}</button>
)

// One collapsible block inside a job tab. The count in the header is the whole
// point: you can tell whether a section is worth opening WITHOUT opening it,
// which is what the old tab rows could never do — every tab looked identical
// whether it held 40 receipts or nothing.
const JobSection = ({ title, count, open, onToggle, children }) => (
  <div style={{ marginBottom: '6px' }}>
    <button type="button" onClick={onToggle} aria-expanded={open}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', borderBottom: '1px solid #EEE', padding: '10px 4px', cursor: 'pointer', textAlign: 'left', minHeight: 'var(--tap)' }}>
      <span style={{ fontSize: '11px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>{title}</span>
      {count > 0 && <span style={{ fontSize: '11px', fontWeight: '700', color: '#E07B2A', background: '#FFF7ED', borderRadius: '999px', padding: '2px 8px' }}>{count}</span>}
      <span style={{ flex: 1 }} />
      <span style={{ color: '#9CA3AF', fontSize: '13px' }}>{open ? '▾' : '▸'}</span>
    </button>
    {open && <div style={{ paddingTop: '10px' }}>{children}</div>}
  </div>
)

// Sunday-start week key (YYYY-MM-DD), used to group pay into weekly paychecks.
const dateKey = (d) => {
  const x = new Date(d)
  const pad = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}
// Photos and written log entries, merged into one newest-first feed of days.
// They were two separate tabs, but on a real job they are the same act: "here
// is what happened today." Logs carry a plain 'YYYY-MM-DD' log_date; photos
// carry a created_at timestamp, so both get reduced to the same day key.
const buildDayFeed = (logs, photos) => {
  const days = {}
  const day = (k) => (days[k] = days[k] || { key: k, logs: [], photos: [] })
  ;(logs || []).forEach((l) => day(String(l.log_date).slice(0, 10)).logs.push(l))
  ;(photos || []).forEach((p) => day(dateKey(p.created_at)).photos.push(p))
  return Object.values(days).sort((a, b) => (a.key < b.key ? 1 : -1))
}
const weekStartKey = (dateLike) => {
  const d = new Date(dateLike)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return dateKey(d)
}
const addDaysKey = (key, days) => {
  const d = new Date(key + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return dateKey(d)
}

// Supabase caps an unbounded select() at ~1000 rows, which silently undercounts
// money on big accounts. For sums that must be complete, page through with
// .range() until a short page comes back. `queryFor(from, to)` returns a
// supabase query with .range(from, to) already applied.
const fetchAllRows = async (queryFor) => {
  const pageSize = 1000
  const all = []
  let from = 0
  for (;;) {
    const { data, error } = await queryFor(from, from + pageSize - 1)
    if (error) throw error
    const batch = data || []
    all.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return all
}

function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [message, onClose])
  if (!message) return null
  return (
    <div style={{
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      background: type === 'success' ? '#16A34A' : '#DC2626',
      color: 'white', padding: '12px 24px', borderRadius: '24px',
      fontSize: '14px', fontWeight: '600', zIndex: 999,
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      maxWidth: 'calc(100vw - 48px)', whiteSpace: 'normal', wordBreak: 'break-word', textAlign: 'center'
    }}>{message}</div>
  )
}

function PhotoViewer({ receipt, onClose, onDelete }) {
  const [imgUrl, setImgUrl] = useState(null)
  const [imgErr, setImgErr] = useState(false)
  useEffect(() => {
    let active = true
    setImgUrl(null)
    setImgErr(false)
    const path = receipt && receipt.photo_url
    if (!path) return
    // Legacy rows may hold a full URL; use it directly. Otherwise mint a short-
    // lived signed URL (the bucket is private). Surface a terminal error instead
    // of spinning forever if signing fails.
    if (/^https?:\/\//.test(path)) { setImgUrl(path); return }
    supabase.storage.from('receipts').createSignedUrl(path, 300)
      .then(({ data, error }) => {
        if (!active) return
        if (data && data.signedUrl) setImgUrl(data.signedUrl)
        else setImgErr(true)
      })
      .catch(() => { if (active) setImgErr(true) })
    return () => { active = false }
  }, [receipt])
  if (!receipt) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'white', borderRadius: '20px 20px 0 0', padding: '20px',
        width: '100%', maxHeight: '90vh', overflowY: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '700' }}>{receipt.description}</h2>
          <button aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#888' }}>×</button>
        </div>
        {receipt.photo_url
          ? (imgUrl
            ? <img src={imgUrl} alt="Receipt" style={{ width: '100%', borderRadius: '12px', objectFit: 'contain', maxHeight: '400px' }} />
            : imgErr
              ? <div style={{ background: '#f4f6f9', borderRadius: '12px', height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626' }}>Couldn't load photo</div>
              : <div style={{ background: '#f4f6f9', borderRadius: '12px', height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>Loading photo…</div>)
          : <div style={{ background: '#f4f6f9', borderRadius: '12px', height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>No photo saved</div>
        }
        <div style={{ marginTop: '16px' }}>
          <p style={{ fontSize: '14px', color: '#666' }}>{receipt.store} · {receipt.category}</p>
          <p style={{ fontSize: '22px', fontWeight: '700', color: '#DC2626', marginTop: '8px' }}>{formatCurrency(receipt.amount)}</p>
          <p style={{ fontSize: '12px', color: '#717171', marginTop: '4px' }}>{new Date(receipt.created_at).toLocaleDateString()}</p>
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(receipt)}
            style={{
              marginTop: '20px', width: '100%', padding: '12px', borderRadius: '12px',
              border: '1px solid #DC2626', background: 'white', color: '#DC2626',
              fontSize: '15px', fontWeight: '600', cursor: 'pointer'
            }}
          >
            Delete this expense
          </button>
        )}
      </div>
    </div>
  )
}

// Renders a job photo whose source may be a full URL (seed/demo data) or a
// storage path in the private 'receipts' bucket (real uploads → signed URL).
function JobPhoto({ path, alt, style, onClick, signedUrl }) {
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let active = true
    setUrl(null); setErr(false)
    if (!path) { setErr(true); return }
    if (/^https?:\/\//.test(path)) { setUrl(path); return }
    // Prefer a batched signed URL passed by the gallery (one storage request for
    // the whole grid, T2.5). Fall back to signing this one path (e.g. lightbox).
    if (signedUrl) { setUrl(signedUrl); return }
    supabase.storage.from('receipts').createSignedUrl(path, 3600)
      .then(({ data }) => { if (active) { if (data && data.signedUrl) setUrl(data.signedUrl); else setErr(true) } })
      .catch(() => { if (active) setErr(true) })
    return () => { active = false }
  }, [path, signedUrl])
  const base = { background: '#eef1f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }
  if (err) return <div onClick={onClick} style={{ ...base, ...style }}>📷</div>
  if (!url) return <div onClick={onClick} style={{ ...base, ...style }} />
  return <img src={url} alt={alt || 'Job photo'} onClick={onClick} style={style} />
}

export default function OwnerDashboard({ profile, sub, billingEnforced }) {
  const [activeTab, setActiveTab] = useState('home')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [projects, setProjects] = useState([])
  const [removingSample, setRemovingSample] = useState(false) // demo-job cleanup in flight
  // Social proof. The ask only ever fires after a REAL job closes in the black —
  // see maybeAskForTestimonial. null = not asking.
  const [testimonialAsk, setTestimonialAsk] = useState(null)
  const [testimonialForm, setTestimonialForm] = useState({ quote: '', author_name: '', company_name: '', city: '', rating: 5, permission: false })
  const [testimonialSaving, setTestimonialSaving] = useState(false)
  const [workers, setWorkers] = useState([])
  const [workerStats, setWorkerStats] = useState({}) // keyed by worker id
  // Open shifts — time entries with no clocked_out_at. Every OTHER time query in
  // this file filters those OUT (they have no total_minutes or labor_cost yet, so
  // they'd poison hours and payroll), which meant the owner had no way to see who
  // is actually working right now. This is the one query that wants them.
  const [onTheClock, setOnTheClock] = useState([])
  const [workersError, setWorkersError] = useState(false) // true when worker stats / assignments / time-off failed to load
  const [spendByProject, setSpendByProject] = useState({}) // keyed by project id: { materials, labor, other }
  const [spendError, setSpendError] = useState(false) // true when the live spend fetch failed (don't render a silent $0)
  const [selectedProject, setSelectedProject] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false) // job detail tables in flight (show loading, not a false empty-state)
  const [projectTab, setProjectTab] = useState('work')
  // Sections are OPEN by default (this is a scrolling page, not an accordion) —
  // this only remembers the ones you deliberately folded away.
  const [closedSections, setClosedSections] = useState({})
  const isOpen = (k) => !closedSections[k]
  const toggleSection = (k) => setClosedSections(s => ({ ...s, [k]: !s[k] }))
  const [receipts, setReceipts] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [scheduleEntries, setScheduleEntries] = useState([])
  const [showNewJob, setShowNewJob] = useState(false)
  const [showEditJob, setShowEditJob] = useState(false)
  const [editJobForm, setEditJobForm] = useState({ name: '', client_name: '', client_phone: '', client_email: '', client_address: '', materials_budget: '', labor_budget: '', profit_target: '' })
  const [showNewReceipt, setShowNewReceipt] = useState(false)
  const [showNewSchedule, setShowNewSchedule] = useState(false)
  const [showAssignWorker, setShowAssignWorker] = useState(null)
  const [showEditRate, setShowEditRate] = useState(null)
  const [assignedWorkerIds, setAssignedWorkerIds] = useState([]) // worker ids with ≥1 job assignment
  const [assignProjectId, setAssignProjectId] = useState('')
  const [editRate, setEditRate] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const [scanError, setScanError] = useState('')
  const [photoViewer, setPhotoViewer] = useState(null)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState('success')
  const [inlineError, setInlineError] = useState('')
  const [settingsForm, setSettingsForm] = useState({ company_name: profile.company_name || '', full_name: profile.full_name || '' })
  const [settingsSaving, setSettingsSaving] = useState(false)
  // Account deletion is two-step on purpose — see the card at the bottom of
  // Settings. deleteOpen reveals the confirmation, deleteConfirm must match the
  // account's own email before the button enables.
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [reportYear, setReportYear] = useState(new Date().getFullYear())
  const [jobForm, setJobForm] = useState({ name: '', client_name: '', client_phone: '', client_email: '', client_address: '', materials_budget: '', labor_budget: '', profit_target: '' })
  const [receiptForm, setReceiptForm] = useState({ description: '', store: '', amount: '', tax: '', category: 'materials', photo_url: '', purchase_date: '' })
  // Did the owner actually accept a scan for THIS receipt? scanResult is cleared
  // the moment he taps "Looks right", so it can't be used as the analytics flag.
  const [scanUsed, setScanUsed] = useState(false)
  const [scheduleForm, setScheduleForm] = useState({ worker_id: '', project_id: '', task_description: '', scheduled_date: '', start_time: '', end_time: '' })
  const [mileageEntries, setMileageEntries] = useState([])
  const [showNewMileage, setShowNewMileage] = useState(false)
  const [mileageForm, setMileageForm] = useState({ trip_date: '', miles: '', rate: String(DEFAULT_MILEAGE_RATE), notes: '' })
  const [showNewTime, setShowNewTime] = useState(false)
  const [timeForm, setTimeForm] = useState({ worker_id: '', work_date: '', start_time: '', end_time: '' })
  const [payroll, setPayroll] = useState([])
  const [paychecks, setPaychecks] = useState([])
  // Getting-paid + field features
  const [coByProject, setCoByProject] = useState({}) // approved change-order $ per project id
  const [dailyLogs, setDailyLogs] = useState([])
  const [changeOrders, setChangeOrders] = useState([])
  const [jobPhotos, setJobPhotos] = useState([])
  const [photoUrls, setPhotoUrls] = useState({}) // storage path → signed URL, batch-signed once per gallery load
  const [punchItems, setPunchItems] = useState([])
  const [materialItems, setMaterialItems] = useState([])
  const [jobDocuments, setJobDocuments] = useState([])
  // Owner-initiated worker invites (copy link, text it to the hire)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  // Live (unclaimed, unrevoked) invite links. Without this the owner had no
  // idea who he'd sent a link to and who had actually joined — the link was
  // shown once and then gone forever, so "did Mike ever sign up?" had no
  // answer and re-sending meant making a second link for the same guy.
  const [openInvites, setOpenInvites] = useState([])
  // Worker time-off requests (owner approves / denies)
  const [timeOff, setTimeOff] = useState([])
  const [punchInput, setPunchInput] = useState('')
  const [materialInput, setMaterialInput] = useState({ name: '', qty: '' })
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [invoices, setInvoices] = useState([])
  const [invoicesLoaded, setInvoicesLoaded] = useState(false)
  const [estimatesLoaded, setEstimatesLoaded] = useState(false)
  const [showNewLog, setShowNewLog] = useState(false)
  const [showNewChange, setShowNewChange] = useState(false)
  const [showNewInvoice, setShowNewInvoice] = useState(false)
  const [photoLightbox, setPhotoLightbox] = useState(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoNote, setPhotoNote] = useState('') // optional note attached to the owner's next photo
  const [logForm, setLogForm] = useState({ log_date: '', weather: '', note: '' })
  const [changeForm, setChangeForm] = useState({ description: '', amount: '', status: 'approved' })
  const [invoiceForm, setInvoiceForm] = useState({ project_id: '', label: '', amount: '', issued_date: '', due_date: '', notes: '', payment_link: '' })
  const [estimates, setEstimates] = useState([])
  const [showNewEstimate, setShowNewEstimate] = useState(false)
  const [editingEstimateId, setEditingEstimateId] = useState(null)
  const [estimateForm, setEstimateForm] = useState({ client_name: '', client_phone: '', client_email: '', title: '', tax_rate: '', tax_mode: DEFAULT_TAX_MODE, notes: '' })
  const [estimateItems, setEstimateItems] = useState([{ description: '', qty: '1', unit_price: '', kind: 'materials' }])
  const [upcomingSchedule, setUpcomingSchedule] = useState([])
  // The crew week grid. Sunday-start on purpose: it's the same week boundary
  // Crew Pay uses, so the shifts you see in a week are the shifts in that
  // paycheck. A Monday-start calendar next to a Sunday-start paycheck is how
  // you end up arguing with a worker about which week Saturday belonged to.
  const [crewWeekStart, setCrewWeekStart] = useState(() => weekStartKey(new Date()))
  const [crewWeek, setCrewWeek] = useState([])
  const [crewWeekLoading, setCrewWeekLoading] = useState(false)
  const [complianceItems, setComplianceItems] = useState([])
  const [warranties, setWarranties] = useState([])
  const [permits, setPermits] = useState([])
  const [showNewCompliance, setShowNewCompliance] = useState(false)
  const [showNewWarranty, setShowNewWarranty] = useState(false)
  const [showNewPermit, setShowNewPermit] = useState(false)
  const [complianceForm, setComplianceForm] = useState({ kind: 'insurance', name: '', reference: '', expires_on: '', notes: '' })
  const [warrantyForm, setWarrantyForm] = useState({ project_id: '', description: '', status: 'open', due_on: '' })
  const [permitForm, setPermitForm] = useState({ name: '', status: 'applied', permit_number: '', inspection_on: '', notes: '' })

  const showToast = (msg, type = 'success') => { setToast(msg); setToastType(type) }

  // Save the owner's editable business info. company_name / full_name are the
  // only profile columns an owner may change (role/owner_id/email/created_at/
  // hourly_rate are locked server-side by lock_profile_identity — FIX-15).
  const saveSettings = async () => {
    const company = settingsForm.company_name.trim()
    const name = settingsForm.full_name.trim()
    if (!company) { showToast('Company name can’t be empty', 'error'); return }
    setSettingsSaving(true)
    try {
      const { error } = await supabase.from('profiles')
        .update({ company_name: company, full_name: name })
        .eq('id', profile.id)
      if (error) throw error
      // Keep the in-memory prop-derived form in sync so it survives a tab switch.
      profile.company_name = company
      profile.full_name = name
      showToast('Saved ✓')
    } catch (e) {
      showToast('Could not save. Check your connection and try again.', 'error')
    } finally {
      setSettingsSaving(false)
    }
  }

  // Erase the account for real. The server re-checks everything this screen
  // checks (it never trusts the client with a destructive call), so the button
  // state here is a courtesy, not the gate.
  const deleteAccount = async () => {
    setDeleting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session && session.access_token}`,
        },
        body: JSON.stringify({ confirmEmail: deleteConfirm.trim() }),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok || !out.ok) throw new Error(out.error || 'Delete failed')
      // The login no longer exists, so there is nothing to sign out of and no
      // screen left to render. Clear the local session and go to the front
      // door — anything else leaves the app querying as a deleted user and
      // throwing 401s at somebody who just left on good terms.
      await supabase.auth.signOut().catch(() => {})
      window.location.assign('/?deleted=1')
    } catch (e) {
      showToast(e.message || 'Could not delete your account. Try again.', 'error')
      setDeleting(false)
    }
  }

  // Friendly date range for time-off ("Jun 18" or "Jun 18 – Jun 20").
  // T00:00:00 keeps date-only columns from drifting a day in local time.
  const formatDateRange = (start, end) => {
    const opts = { month: 'short', day: 'numeric' }
    const s = new Date(start + 'T00:00:00').toLocaleDateString('en-US', opts)
    if (!end || end === start) return s
    const e = new Date(end + 'T00:00:00').toLocaleDateString('en-US', opts)
    return `${s} – ${e}`
  }

  const fetchProjects = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('projects').select('*').eq('owner_id', profile.id).order('created_at', { ascending: false })
      if (error) throw error
      setProjects(data || [])
    } catch (e) {
      showToast('Failed to load jobs', 'error')
    }
  }, [profile.id])

  const fetchWorkers = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('owner_id', profile.id).eq('role', 'worker')
      if (error) throw error
      setWorkers(data || [])
    } catch (e) {
      showToast('Failed to load workers', 'error')
    }
  }, [profile.id])

  // Every invite this owner has made that nobody has claimed yet. RLS scopes
  // the read to him, so no owner filter is needed here.
  const fetchOpenInvites = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('worker_invites')
        .select('id, token, worker_name, created_at')
        .is('used_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      setOpenInvites(data || [])
    } catch {
      // Non-fatal: the list just doesn't render. Never block the Workers tab.
      setOpenInvites([])
    }
  }, [])

  // Which workers are assigned to at least one job. A worker can't clock in
  // until they're assigned, so the Workers tab flags anyone with zero jobs.
  const fetchAssignments = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('project_workers').select('worker_id')
      if (error) throw error
      setAssignedWorkerIds([...new Set((data || []).map(r => r.worker_id))])
    } catch (e) {
      // non-fatal — the nudge just won't show — but flag it so the Workers tab
      // can offer a retry instead of pretending everything loaded (T1.5).
      console.error('Assignments fetch failed:', e)
      setWorkersError(true)
    }
  }, [])

  // Time-off requests addressed to this owner. Worker names are resolved
  // from the already-loaded `workers` list in render (no profiles embed,
  // which would be ambiguous here — two FKs to profiles).
  const fetchTimeOff = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('time_off_requests').select('*').eq('owner_id', profile.id).order('created_at', { ascending: false })
      if (error) throw error
      setTimeOff(data || [])
    } catch (e) {
      // non-fatal — the rest of the Workers tab still works — but flag it (T1.5).
      console.error('Time-off fetch failed:', e)
      setWorkersError(true)
    }
  }, [profile.id])

  const fetchWorkerStats = useCallback(async (workerList) => {
    if (!workerList?.length) return
    try {
      const workerIds = workerList.map(w => w.id)
      // Page past the 1000-row cap — a busy crew's lifetime shifts exceed it, and
      // an undercount here understates each worker's hours + labor cost.
      const data = await fetchAllRows((from, to) => supabase
        .from('time_entries')
        .select('worker_id, total_minutes, labor_cost, clocked_in_at')
        .in('worker_id', workerIds)
        .not('clocked_out_at', 'is', null)
        .range(from, to))

      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

      const stats = {}
      workerIds.forEach(id => {
        const entries = (data || []).filter(e => e.worker_id === id)
        const monthEntries = entries.filter(e => e.clocked_in_at >= monthStart)
        stats[id] = {
          totalMinutes: entries.reduce((s, e) => s + (e.total_minutes || 0), 0),
          totalCost: entries.reduce((s, e) => s + (e.labor_cost || 0), 0),
          monthMinutes: monthEntries.reduce((s, e) => s + (e.total_minutes || 0), 0),
          monthCost: monthEntries.reduce((s, e) => s + (e.labor_cost || 0), 0),
        }
      })
      setWorkerStats(stats)
      setWorkersError(false)
    } catch (e) {
      console.error('Worker stats fetch failed:', e)
      setWorkersError(true)
    }
  }, [])

  // Who is on the clock this second. Small, cheap, and deliberately not paged —
  // if a crew somehow has 1000 simultaneously open shifts, the count on the home
  // screen being capped is the least of anyone's problems.
  const fetchOnTheClock = useCallback(async (workerList) => {
    const workerIds = (workerList || []).map(w => w.id)
    if (!workerIds.length) { setOnTheClock([]); return }
    try {
      const { data, error } = await supabase
        .from('time_entries')
        .select('id, worker_id, project_id, clocked_in_at')
        .in('worker_id', workerIds)
        .is('clocked_out_at', null)
        .order('clocked_in_at', { ascending: true })
      if (error) throw error
      setOnTheClock(data || [])
    } catch (e) {
      // Non-fatal: the card just doesn't render. Never show a false "0 working".
      console.error('On-the-clock fetch failed:', e)
      setOnTheClock([])
    }
  }, [])

  // Build weekly pay rows (one per worker per week) from clocked-out time, and
  // load any paychecks already recorded so each week shows paid vs. owed.
  const fetchPayroll = useCallback(async () => {
    const workerIds = workers.map(w => w.id)
    if (!workerIds.length) { setPayroll([]); setPaychecks([]); return }
    try {
      // Page past the 1000-row cap so weekly gross is complete on busy crews.
      const [times, { data: checks }] = await Promise.all([
        fetchAllRows((from, to) => supabase.from('time_entries').select('worker_id, total_minutes, labor_cost, clocked_in_at').in('worker_id', workerIds).not('clocked_out_at', 'is', null).range(from, to)),
        supabase.from('paychecks').select('*').eq('owner_id', profile.id)
      ])
      setPaychecks(checks || [])
      const rows = {}
      ;(times || []).forEach(t => {
        const ws = weekStartKey(t.clocked_in_at)
        const key = t.worker_id + '|' + ws
        if (!rows[key]) rows[key] = { worker_id: t.worker_id, week_start: ws, minutes: 0, gross: 0 }
        rows[key].minutes += t.total_minutes || 0
        rows[key].gross += t.labor_cost || 0
      })
      setPayroll(Object.values(rows).sort((a, b) => b.week_start.localeCompare(a.week_start)))
    } catch (e) {
      console.error('Payroll fetch failed:', e)
    }
  }, [workers, profile.id])

  const recordPaycheck = async (row) => {
    setLoading(true)
    try {
      const { error } = await supabase.from('paychecks').insert({
        owner_id: profile.id, worker_id: row.worker_id,
        week_start: row.week_start, week_end: addDaysKey(row.week_start, 6),
        total_minutes: row.minutes, gross_pay: roundCents(row.gross),
        paid_at: new Date().toISOString()
      })
      if (error) throw error
      await fetchPayroll()
      showToast('Paycheck recorded ✓')
    } catch (e) {
      showToast('Failed to record paycheck', 'error')
    }
    setLoading(false)
  }

  // Compute each job's spending LIVE from the source records (receipts +
  // clocked-out time entries) instead of trusting denormalized running-total
  // columns. This keeps profit accurate, counts every receipt category, and
  // means editing/deleting a record self-corrects the totals automatically.
  const fetchSpend = useCallback(async (projectList) => {
    if (!projectList?.length) { setSpendByProject({}); setCoByProject({}); setSpendError(false); return }
    try {
      const ids = projectList.map(p => p.id)
      // Receipts + time entries are the high-volume tables that drive spend, so
      // page past the 1000-row cap (fetchAllRows) — otherwise big accounts under-
      // count. tax_amount is part of what a receipt actually cost the owner.
      const [rcpts, times, { data: cos }] = await Promise.all([
        fetchAllRows((from, to) => supabase.from('receipts').select('project_id, amount, category, tax_amount').eq('owner_id', profile.id).range(from, to)),
        fetchAllRows((from, to) => supabase.from('time_entries').select('project_id, labor_cost').in('project_id', ids).not('clocked_out_at', 'is', null).range(from, to)),
        supabase.from('change_orders').select('project_id, amount, status').eq('owner_id', profile.id)
      ])
      const spend = {}
      ids.forEach(id => { spend[id] = { materials: 0, labor: 0, other: 0 } })
      ;(rcpts || []).forEach(r => {
        if (!spend[r.project_id]) spend[r.project_id] = { materials: 0, labor: 0, other: 0 }
        const cost = (r.amount || 0) + (r.tax_amount || 0)
        if (r.category === 'materials') spend[r.project_id].materials += cost
        else spend[r.project_id].other += cost
      })
      ;(times || []).forEach(t => {
        if (!spend[t.project_id]) spend[t.project_id] = { materials: 0, labor: 0, other: 0 }
        spend[t.project_id].labor += t.labor_cost || 0
      })
      const co = {}
      ;(cos || []).forEach(c => {
        if (c.status === 'approved') co[c.project_id] = (co[c.project_id] || 0) + (c.amount || 0)
      })
      setSpendByProject(spend)
      setCoByProject(co)
      setSpendError(false)
    } catch (e) {
      // Don't leave a silent $0 — surface a retry affordance instead (T1.5).
      console.error('Spend fetch failed:', e)
      setSpendError(true)
    }
  }, [profile.id])

  const fetchInvoices = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('invoices')
        .select('*, projects(name, client_name, client_email)')
        .eq('owner_id', profile.id)
        .order('issued_date', { ascending: false })
      if (error) throw error
      setInvoices(data || [])
    } catch (e) { console.error('Invoices fetch failed:', e); showToast('Could not load invoices. Check your connection and try again.', 'error') }
    finally { setInvoicesLoaded(true) }
  }, [profile.id])

  const fetchEstimates = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('estimates')
        .select('*')
        .eq('owner_id', profile.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      setEstimates(data || [])
    } catch (e) { console.error('Estimates fetch failed:', e); showToast('Could not load estimates. Check your connection and try again.', 'error') }
    finally { setEstimatesLoaded(true) }
  }, [profile.id])

  const fetchUpcomingSchedule = useCallback(async () => {
    try {
      const today = todayLocal()
      const { data, error } = await supabase.from('schedule_entries')
        .select('*, projects(name), profiles!schedule_entries_worker_id_fkey(full_name)')
        .eq('owner_id', profile.id)
        .gte('scheduled_date', today)
        .order('scheduled_date', { ascending: true })
      if (error) throw error
      setUpcomingSchedule(data || [])
    } catch (e) { console.error('Upcoming schedule fetch failed:', e); showToast('Could not load the schedule. Check your connection and try again.', 'error') }
  }, [profile.id])

  // One week of shifts across every job. Deliberately NOT filtered from
  // upcomingSchedule (which starts at today) — the owner needs to page back to
  // last week to answer "what did I have him down for on Tuesday."
  const fetchCrewWeek = useCallback(async (startKey) => {
    setCrewWeekLoading(true)
    try {
      const { data, error } = await supabase.from('schedule_entries')
        .select('*, projects(name), profiles!schedule_entries_worker_id_fkey(full_name)')
        .eq('owner_id', profile.id)
        .gte('scheduled_date', startKey)
        .lte('scheduled_date', addDaysKey(startKey, 6))
        .order('start_time', { ascending: true, nullsFirst: false })
      if (error) throw error
      setCrewWeek(data || [])
    } catch (e) { console.error('Crew week fetch failed:', e); showToast('Could not load the week. Check your connection and try again.', 'error') }
    finally { setCrewWeekLoading(false) }
  }, [profile.id])

  const fetchCompliance = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('compliance_items').select('*').eq('owner_id', profile.id).order('expires_on', { ascending: true })
      if (error) throw error
      setComplianceItems(data || [])
    } catch (e) { console.error('Compliance fetch failed:', e); showToast('Could not load insurance & licenses. Check your connection and try again.', 'error') }
  }, [profile.id])

  const fetchWarranties = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('warranties').select('*, projects(name)').eq('owner_id', profile.id).order('created_at', { ascending: false })
      if (error) throw error
      setWarranties(data || [])
    } catch (e) { console.error('Warranties fetch failed:', e); showToast('Could not load warranties. Check your connection and try again.', 'error') }
  }, [profile.id])

  useEffect(() => {
    Promise.all([fetchProjects(), fetchWorkers(), fetchTimeOff(), fetchAssignments(), fetchOpenInvites()]).finally(() => setInitialLoading(false))
  }, [fetchProjects, fetchWorkers, fetchTimeOff, fetchAssignments, fetchOpenInvites])

  useEffect(() => {
    if (workers.length) fetchWorkerStats(workers)
  }, [workers, fetchWorkerStats])

  // Re-read open shifts every time the owner lands on Home or Crew. "Who's
  // working right now" is worthless if it's a snapshot from whenever the app was
  // opened, and a poll would run all day for a number nobody is looking at.
  useEffect(() => {
    if (activeTab === 'home' || activeTab === 'workers') fetchOnTheClock(workers)
  }, [activeTab, workers, fetchOnTheClock])

  useEffect(() => {
    fetchSpend(projects)
  }, [projects, fetchSpend])

  useEffect(() => {
    if (activeTab === 'payroll' && workers.length) fetchPayroll()
  }, [activeTab, workers, fetchPayroll])

  // Refetch on every visit AND on every arrow — the week you're looking at is
  // the query, so paging weeks is a fetch, not a filter.
  useEffect(() => {
    if (activeTab === 'crewweek') fetchCrewWeek(crewWeekStart)
  }, [activeTab, crewWeekStart, fetchCrewWeek])

  // Invoices/estimates are fetched once, then reused across tabs — the
  // *Loaded flags stop every tab visit from refiring the query (T2.4). Mutations
  // (add/edit/delete invoice/estimate) still call fetch* directly as the refresh
  // path, which resets the data regardless of the flag.
  useEffect(() => {
    if (activeTab === 'invoices' && !invoicesLoaded) fetchInvoices()
  }, [activeTab, invoicesLoaded, fetchInvoices])

  useEffect(() => {
    if (activeTab === 'estimates' && !estimatesLoaded) fetchEstimates()
  }, [activeTab, estimatesLoaded, fetchEstimates])

  useEffect(() => {
    if (activeTab === 'home') { if (!invoicesLoaded) fetchInvoices(); if (!estimatesLoaded) fetchEstimates(); fetchUpcomingSchedule(); fetchCompliance() }
    if (activeTab === 'clients' && !invoicesLoaded) fetchInvoices()
    if (activeTab === 'calendar') fetchUpcomingSchedule()
    if (activeTab === 'compliance') fetchCompliance()
    if (activeTab === 'warranties') fetchWarranties()
    if (activeTab === 'insights') { if (!invoicesLoaded) fetchInvoices(); if (!estimatesLoaded) fetchEstimates() }
  }, [activeTab, invoicesLoaded, estimatesLoaded, fetchInvoices, fetchEstimates, fetchUpcomingSchedule, fetchCompliance, fetchWarranties])

  const fetchProjectDetails = async (project) => {
    setSelectedProject(project)
    // Clear the previous job's detail data first, so opening job B never
    // flashes job A's receipts/photos/etc. while these queries are in flight.
    setReceipts([]); setTimeEntries([]); setScheduleEntries([]); setMileageEntries([])
    setDailyLogs([]); setChangeOrders([]); setJobPhotos([]); setPhotoUrls({}); setPunchItems([])
    setMaterialItems([]); setJobDocuments([]); setPermits([])
    // Tabs render a loading state (not a false "no receipts/photos" empty-state)
    // while these queries are in flight (T2.6).
    setDetailLoading(true)
    try {
      const pid = project.id
      // Load all 11 detail tables in parallel (was 11 serial round-trips → ~10x
      // faster job open). Same queries/filters/order; just no longer waterfalled.
      const [r, t, s, m, lg, cor, ph, pu, mt, dc, pm] = await Promise.all([
        supabase.from('receipts').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
        supabase.from('time_entries').select('*, profiles(full_name)').eq('project_id', pid).order('clocked_in_at', { ascending: false }),
        supabase.from('schedule_entries').select('*, profiles!schedule_entries_worker_id_fkey(full_name)').eq('project_id', pid).order('scheduled_date', { ascending: true }),
        supabase.from('mileage_entries').select('*').eq('project_id', pid).order('trip_date', { ascending: false }),
        supabase.from('daily_logs').select('*').eq('project_id', pid).order('log_date', { ascending: false }),
        supabase.from('change_orders').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
        supabase.from('job_photos').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
        supabase.from('punch_items').select('*').eq('project_id', pid).order('created_at', { ascending: true }),
        supabase.from('material_items').select('*').eq('project_id', pid).order('created_at', { ascending: true }),
        supabase.from('job_documents').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
        supabase.from('permits').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
      ])
      setReceipts(r.data || [])
      setTimeEntries(t.data || [])
      setScheduleEntries(s.data || [])
      setMileageEntries(m.data || [])
      setDailyLogs(lg.data || [])
      setChangeOrders(cor.data || [])
      const photos = ph.data || []
      setJobPhotos(photos)
      setPunchItems(pu.data || [])
      setMaterialItems(mt.data || [])
      setJobDocuments(dc.data || [])
      setPermits(pm.data || [])
      // Sign every storage-path photo in ONE request instead of one-per-photo
      // (T2.5). Full-URL seed/demo photos need no signing.
      const paths = photos.map(p => p.photo_url).filter(u => u && !/^https?:\/\//.test(u))
      if (paths.length) {
        const { data: signed } = await supabase.storage.from('receipts').createSignedUrls(paths, 3600)
        const map = {}
        ;(signed || []).forEach(s => { if (s && s.signedUrl && s.path) map[s.path] = s.signedUrl })
        setPhotoUrls(map)
      }
    } catch (e) {
      showToast('Failed to load job details', 'error')
    } finally {
      setDetailLoading(false)
    }
  }

  // Refetch a SINGLE detail table for the open job instead of re-running all 11
  // detail queries after a one-row mutation (T2.3). Keeps the changed tab in
  // sync without the full-refetch storm; other tabs already hold their data.
  // selectStr defaults to '*'; pass a join (e.g. '*, profiles(full_name)') for
  // tables the list rows need it. `after(rows)` runs post-set for extra work
  // like signing photo URLs. Both optional → old 4-arg callers keep working.
  const refetchDetail = async (table, setter, orderCol, ascending, selectStr, after) => {
    if (!selectedProject) return
    try {
      const { data, error } = await supabase.from(table).select(selectStr || '*').eq('project_id', selectedProject.id).order(orderCol, { ascending })
      if (error) throw error
      const rows = data || []
      setter(rows)
      if (after) await after(rows)
    } catch (e) {
      console.error('Detail refetch failed (' + table + '):', e)
    }
  }

  // Job photos need their storage paths signed after a refetch (same batch-sign
  // as the full load). Its own helper so add/delete photo can refresh one table
  // instead of re-running all 11 detail queries (T2.3).
  const refetchJobPhotos = () => refetchDetail('job_photos', setJobPhotos, 'created_at', false, '*', async (photos) => {
    const paths = photos.map(p => p.photo_url).filter(u => u && !/^https?:\/\//.test(u))
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('receipts').createSignedUrls(paths, 3600)
      const map = {}
      ;(signed || []).forEach(s => { if (s && s.signedUrl && s.path) map[s.path] = s.signedUrl })
      setPhotoUrls(map)
    }
  })

  // Owner manually logs a worker's time on a job (for crew who don't clock in
  // via the worker app). Mirrors the worker clock-out cost math:
  // labor_cost = (minutes / 60) * the worker's hourly_rate.
  const addTimeEntry = async () => {
    if (!timeForm.worker_id) return setInlineError('Pick a worker')
    if (!timeForm.work_date || !timeForm.start_time || !timeForm.end_time) return setInlineError('Date, start and end time are required')
    const startAt = new Date(`${timeForm.work_date}T${timeForm.start_time}`)
    const endAt = new Date(`${timeForm.work_date}T${timeForm.end_time}`)
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) return setInlineError('Invalid date or time')
    if (endAt <= startAt) return setInlineError('End time must be after start time')
    const worker = workers.find(w => w.id === timeForm.worker_id)
    const totalMinutes = Math.floor((endAt - startAt) / 60000)
    // Round to cents on the way in — otherwise float noise ((m/60)*rate) persists
    // to the DB and shows up as $123.4560001 in sums. Matches roundCents everywhere else.
    const laborCost = roundCents((totalMinutes / 60) * (worker?.hourly_rate || 0))
    setLoading(true)
    setInlineError('')
    try {
      const { error } = await supabase.from('time_entries').insert({
        project_id: selectedProject.id,
        worker_id: timeForm.worker_id,
        clocked_in_at: startAt.toISOString(),
        clocked_out_at: endAt.toISOString(),
        total_minutes: totalMinutes,
        labor_cost: laborCost
      })
      if (error) throw error
      setShowNewTime(false)
      setTimeForm({ worker_id: '', work_date: '', start_time: '', end_time: '' })
      track(EV.TIME_ADDED)
      await refetchDetail('time_entries', setTimeEntries, 'clocked_in_at', false, '*, profiles(full_name)')
      showToast('Time added ✓')
    } catch (e) {
      setInlineError('Failed to add time. Try again.')
    } finally {
      setLoading(false)
    }
  }

  // Remove a worker from the owner's crew. Soft-unlink (owner_id → null) rather
  // than delete: the worker's account and any hours already logged on jobs stay
  // intact (time_entries.worker_id cascades on delete, so a hard delete would
  // erase their labor from past job-cost history). They can re-link later.
  const removeWorker = async (w) => {
    if (!window.confirm(`Remove ${w.full_name} from your crew?\n\nHours they already logged on jobs stay intact, but they'll no longer show here or be assignable. They can re-link anytime by entering your email when they sign in.`)) return
    setLoading(true)
    try {
      const { error } = await supabase.from('profiles').update({ owner_id: null }).eq('id', w.id)
      if (error) throw error
      setWorkers(prev => prev.filter(x => x.id !== w.id))
      showToast('Worker removed ✓')
    } catch (e) {
      showToast('Failed to remove worker', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Generate the invite link the owner texts to a new hire. The worker opens
  // `/?invite=<token>`, taps one button, and is on the crew — the account is
  // built server-side from this row (api/join-invite.js), so he never types a
  // name, an email, or a password. That's why the name field here matters: what
  // the owner puts in is what the worker's account is called.
  const createInvite = async () => {
    if (!inviteName.trim()) { setInlineError('Enter the worker’s name first.'); return }
    setLoading(true)
    setInlineError('')
    try {
      const token = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2)
      const { error } = await supabase.from('worker_invites').insert({
        owner_id: profile.id, token, worker_name: inviteName.trim()
      })
      if (error) throw error
      track(EV.WORKER_INVITED)
      setInviteLink(`${window.location.origin}/?invite=${token}`)
      setInviteCopied(false)
      fetchOpenInvites()
    } catch (e) {
      setInlineError('Could not create the invite. Try again.')
    } finally {
      setLoading(false)
    }
  }

  // What actually gets texted. A bare URL is the owner's problem to explain,
  // and he explains it as "sign up for the app" — which is the sentence the
  // crew says no to. So we write the text for him, in the words that work:
  // not what the app is, what the worker gets out of tapping it.
  const inviteMessage = (name, link) => {
    const who = (name || '').trim().split(/s+/)[0]
    return (
      `${who ? who + ' - ' : ''}use this to clock in and out from your phone. ` +
      `You'll see your own hours and what they add up to, so you get paid for ` +
      `exactly what you worked. One tap, no password, nothing to download:
${link}`
    )
  }

  const copyInvite = async (name = inviteName, link = inviteLink) => {
    const text = inviteMessage(name, link)
    // On a phone this opens the share sheet straight into Messages, which is
    // the actual job: get the link into a text to that guy. Falls back to the
    // clipboard on desktop, and to the on-screen link if both are blocked.
    if (navigator.share) {
      try {
        await navigator.share({ text })
        setInviteCopied(true)
        return
      } catch {
        // Share sheet dismissed or unavailable — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      setInviteCopied(true)
      showToast('Message copied — paste it into a text ✓')
    } catch {
      // Clipboard blocked (older mobile browser) — the link is shown on
      // screen for a manual long-press copy; flag it as "ready" anyway.
      setInviteCopied(true)
    }
  }

  // Kill a link. Matters more than it used to: a claimed invite is also the
  // passwordless worker's way back in, so this is the only way to cut off a
  // link that ended up on the wrong phone.
  const revokeInvite = async (inv) => {
    try {
      const { error } = await supabase
        .from('worker_invites')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', inv.id)
      if (error) throw error
      setOpenInvites(prev => prev.filter(i => i.id !== inv.id))
      showToast('Link turned off ✓')
    } catch {
      showToast('Could not turn that link off', 'error')
    }
  }

  const resetInvite = () => {
    setShowInvite(false); setInviteName(''); setInviteLink(''); setInviteCopied(false); setInlineError('')
  }

  // Owner approves or denies a worker's time-off request.
  const decideTimeOff = async (req, status) => {
    setLoading(true)
    try {
      const decided_at = new Date().toISOString()
      const { error } = await supabase.from('time_off_requests').update({ status, decided_at }).eq('id', req.id)
      if (error) throw error
      setTimeOff(prev => prev.map(r => r.id === req.id ? { ...r, status, decided_at } : r))
      showToast(status === 'approved' ? 'Time off approved ✓' : 'Request denied')
    } catch (e) {
      showToast('Failed to update request', 'error')
    } finally {
      setLoading(false)
    }
  }

  const addMileage = async () => {
    if (!mileageForm.miles) return setInlineError('Miles are required')
    setLoading(true)
    setInlineError('')
    try {
      const { error } = await supabase.from('mileage_entries').insert({
        owner_id: profile.id, project_id: selectedProject.id,
        trip_date: mileageForm.trip_date || todayLocal(),
        miles: parseFloat(mileageForm.miles || 0),
        rate: parseFloat(mileageForm.rate || DEFAULT_MILEAGE_RATE),
        notes: mileageForm.notes
      })
      if (error) throw error
      setShowNewMileage(false)
      setMileageForm({ trip_date: '', miles: '', rate: String(DEFAULT_MILEAGE_RATE), notes: '' })
      await refetchDetail('mileage_entries', setMileageEntries, 'trip_date', false)
      showToast('Mileage added ✓')
    } catch (e) {
      setInlineError('Failed to add mileage. Try again.')
    }
    setLoading(false)
  }

  const deleteMileage = async (entry) => {
    if (!window.confirm('Delete this mileage entry?')) return
    try {
      const { error } = await supabase.from('mileage_entries').delete().eq('id', entry.id)
      if (error) throw error
      await refetchDetail('mileage_entries', setMileageEntries, 'trip_date', false)
      showToast('Mileage deleted ✓')
    } catch (e) {
      showToast('Failed to delete mileage', 'error')
    }
  }

  // ---- Daily logs ----
  const addLog = async () => {
    if (!logForm.note) return setInlineError('Write a quick note first')
    setLoading(true); setInlineError('')
    try {
      const { error } = await supabase.from('daily_logs').insert({
        owner_id: profile.id, project_id: selectedProject.id,
        log_date: logForm.log_date || todayLocal(),
        weather: logForm.weather || null, note: logForm.note
      })
      if (error) throw error
      setShowNewLog(false); setLogForm({ log_date: '', weather: '', note: '' })
      await refetchDetail('daily_logs', setDailyLogs, 'log_date', false); showToast('Log saved ✓')
    } catch (e) { setInlineError('Failed to save log. Try again.') }
    setLoading(false)
  }
  const deleteLog = async (entry) => {
    if (!window.confirm('Delete this log entry?')) return
    try {
      const { error } = await supabase.from('daily_logs').delete().eq('id', entry.id)
      if (error) throw error
      await refetchDetail('daily_logs', setDailyLogs, 'log_date', false); showToast('Log deleted ✓')
    } catch (e) { showToast('Failed to delete log', 'error') }
  }

  // ---- Change orders ----
  const addChangeOrder = async () => {
    if (!changeForm.description || !changeForm.amount) return setInlineError('Describe the change and its price')
    setLoading(true); setInlineError('')
    try {
      const { error } = await supabase.from('change_orders').insert({
        owner_id: profile.id, project_id: selectedProject.id,
        description: changeForm.description, amount: parseFloat(changeForm.amount || 0),
        status: changeForm.status
      })
      if (error) throw error
      setShowNewChange(false); setChangeForm({ description: '', amount: '', status: 'approved' })
      await refetchDetail('change_orders', setChangeOrders, 'created_at', false); await fetchProjects(); showToast('Extra added ✓')
    } catch (e) { setInlineError('Failed to add extra. Try again.') }
    setLoading(false)
  }
  const deleteChangeOrder = async (co) => {
    if (!window.confirm('Delete this extra?')) return
    try {
      const { error } = await supabase.from('change_orders').delete().eq('id', co.id)
      if (error) throw error
      await refetchDetail('change_orders', setChangeOrders, 'created_at', false); await fetchProjects(); showToast('Extra deleted ✓')
    } catch (e) { showToast('Failed to delete extra', 'error') }
  }

  // ---- Job photos (image stored in the private 'receipts' bucket) ----
  // ---- Punch list ----
  const addPunch = async () => {
    if (!punchInput.trim()) return
    try {
      const { error } = await supabase.from('punch_items').insert({ owner_id: profile.id, project_id: selectedProject.id, description: punchInput.trim() })
      if (error) throw error
      setPunchInput(''); await refetchDetail('punch_items', setPunchItems, 'created_at', true)
    } catch (e) { showToast('Failed to add item', 'error') }
  }
  const togglePunch = async (item) => {
    try {
      const { error } = await supabase.from('punch_items').update({ done: !item.done }).eq('id', item.id)
      if (error) throw error
      setPunchItems(items => items.map(it => it.id === item.id ? { ...it, done: !it.done } : it))
    } catch (e) { showToast('Failed to update', 'error') }
  }
  const deletePunch = async (item) => {
    if (!window.confirm('Delete this item?')) return
    try { const { error } = await supabase.from('punch_items').delete().eq('id', item.id); if (error) throw error; setPunchItems(items => items.filter(it => it.id !== item.id)) } catch (e) { showToast('Failed to delete', 'error') }
  }

  // ---- Shopping list (materials) ----
  const addMaterial = async () => {
    if (!materialInput.name.trim()) return
    try {
      const { error } = await supabase.from('material_items').insert({ owner_id: profile.id, project_id: selectedProject.id, name: materialInput.name.trim(), qty: materialInput.qty.trim() || null })
      if (error) throw error
      setMaterialInput({ name: '', qty: '' }); await refetchDetail('material_items', setMaterialItems, 'created_at', true)
    } catch (e) { showToast('Failed to add item', 'error') }
  }
  const toggleMaterial = async (item) => {
    try {
      const { error } = await supabase.from('material_items').update({ bought: !item.bought }).eq('id', item.id)
      if (error) throw error
      setMaterialItems(items => items.map(it => it.id === item.id ? { ...it, bought: !it.bought } : it))
    } catch (e) { showToast('Failed to update', 'error') }
  }
  const deleteMaterial = async (item) => {
    if (!window.confirm('Delete this item?')) return
    try { const { error } = await supabase.from('material_items').delete().eq('id', item.id); if (error) throw error; setMaterialItems(items => items.filter(it => it.id !== item.id)) } catch (e) { showToast('Failed to delete', 'error') }
  }

  // ---- Job documents (file in 'receipts' bucket) ----
  const addDocument = async (e) => {
    const file = e.target.files[0]; if (!file) return
    setUploadingDoc(true)
    try {
      const fileName = `${profile.id}/docs/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('receipts').upload(fileName, file)
      if (upErr) throw upErr
      const { error } = await supabase.from('job_documents').insert({ owner_id: profile.id, project_id: selectedProject.id, name: file.name, file_url: fileName })
      if (error) throw error
      await refetchDetail('job_documents', setJobDocuments, 'created_at', false); showToast('Document added ✓')
    } catch (err) { showToast('Upload failed', 'error') }
    setUploadingDoc(false)
  }
  const openDocument = async (doc) => {
    try {
      if (/^https?:\/\//.test(doc.file_url)) { window.open(doc.file_url, '_blank'); return }
      const { data } = await supabase.storage.from('receipts').createSignedUrl(doc.file_url, 300)
      if (data && data.signedUrl) window.open(data.signedUrl, '_blank')
      else showToast('Could not open file', 'error')
    } catch (e) { showToast('Could not open file', 'error') }
  }
  const deleteDocument = async (doc) => {
    if (!window.confirm('Delete this document?')) return
    try { const { error } = await supabase.from('job_documents').delete().eq('id', doc.id); if (error) throw error; await refetchDetail('job_documents', setJobDocuments, 'created_at', false); showToast('Document deleted ✓') } catch (e) { showToast('Failed to delete', 'error') }
  }

  const addJobPhoto = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploadingPhoto(true)
    try {
      const fileName = `${profile.id}/jobphotos/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('receipts').upload(fileName, file)
      if (upErr) throw upErr
      const row = {
        owner_id: profile.id, project_id: selectedProject.id, photo_url: fileName,
        caption: photoNote.trim() || null, uploaded_by_name: 'You'
      }
      let { error } = await supabase.from('job_photos').insert(row)
      // Retry without uploaded_by_name if FIX-DATABASE-21 isn't applied yet (42703).
      if (error && error.code === '42703') {
        const { uploaded_by_name, ...legacy } = row
        ;({ error } = await supabase.from('job_photos').insert(legacy))
      }
      if (error) throw error
      setPhotoNote('')
      await refetchJobPhotos(); showToast('Photo added ✓')
    } catch (err) { showToast('Photo upload failed', 'error') }
    setUploadingPhoto(false)
  }
  const deleteJobPhoto = async (photo) => {
    if (!window.confirm('Delete this photo?')) return
    try {
      const { error } = await supabase.from('job_photos').delete().eq('id', photo.id)
      if (error) throw error
      setPhotoLightbox(null)
      await refetchJobPhotos(); showToast('Photo deleted ✓')
    } catch (e) { showToast('Failed to delete photo', 'error') }
  }

  // ---- Invoices (what the client owes / has paid) ----
  // ---- Estimates ----
  const openNewEstimate = () => {
    setEditingEstimateId(null)
    setEstimateForm({ client_name: '', client_phone: '', client_email: '', title: '', tax_rate: '', tax_mode: DEFAULT_TAX_MODE, notes: '' })
    setEstimateItems([{ description: '', qty: '1', unit_price: '', kind: 'materials' }])
    setInlineError(''); setShowNewEstimate(true)
  }
  const openEditEstimate = (est) => {
    setEditingEstimateId(est.id)
    setEstimateForm({
      client_name: est.client_name || '', client_phone: est.client_phone || '', client_email: est.client_email || '',
      title: est.title || '', tax_rate: est.tax_rate ? String(est.tax_rate) : '',
      // Rows written before FIX-DATABASE-28 have no tax_mode; normalize rescues them.
      tax_mode: normalizeTaxMode(est.tax_mode), notes: est.notes || ''
    })
    const items = Array.isArray(est.items) ? est.items : []
    setEstimateItems(items.length
      ? items.map(it => ({ description: it.description || '', qty: String(it.qty ?? '1'), unit_price: String(it.unit_price ?? ''), kind: it.kind || 'materials' }))
      : [{ description: '', qty: '1', unit_price: '', kind: 'materials' }])
    setInlineError(''); setShowNewEstimate(true)
  }
  const setEstimateItem = (i, field, value) => setEstimateItems(items => items.map((it, idx) => idx === i ? { ...it, [field]: value } : it))
  const addEstimateRow = () => setEstimateItems(items => [...items, { description: '', qty: '1', unit_price: '', kind: 'materials' }])
  const removeEstimateRow = (i) => setEstimateItems(items => items.length > 1 ? items.filter((_, idx) => idx !== i) : items)

  const saveEstimate = async () => {
    if (!estimateForm.title && !estimateForm.client_name) return setInlineError('Add a title or client name')
    setLoading(true); setInlineError('')
    try {
      const items = estimateItems
        .filter(it => it.description || it.unit_price)
        .map(it => ({ description: it.description, qty: parseFloat(it.qty) || 0, unit_price: parseFloat(it.unit_price) || 0, kind: it.kind }))
      const payload = {
        owner_id: profile.id, client_name: estimateForm.client_name, client_phone: estimateForm.client_phone || null,
        client_email: estimateForm.client_email || null, title: estimateForm.title, items,
        tax_rate: parseFloat(estimateForm.tax_rate || 0), tax_mode: normalizeTaxMode(estimateForm.tax_mode),
        notes: estimateForm.notes || null
      }
      const write = (body) => editingEstimateId
        ? supabase.from('estimates').update(body).eq('id', editingEstimateId)
        : supabase.from('estimates').insert({ ...body, status: 'draft' })
      let { error } = await write(payload)
      // 42703 = column does not exist: this build is live but FIX-DATABASE-28
      // hasn't been applied yet. Save the estimate anyway rather than losing the
      // owner's typing; the total still computes correctly client-side and the
      // mode starts persisting the moment the migration runs.
      if (error && error.code === '42703') {
        const { tax_mode, ...legacy } = payload
        ;({ error } = await write(legacy))
      }
      if (error) throw error
      setShowNewEstimate(false); setEditingEstimateId(null)
      await fetchEstimates(); showToast('Estimate saved ✓')
    } catch (e) { setInlineError('Failed to save estimate. Try again.') }
    setLoading(false)
  }
  const markEstimateStatus = async (est, status) => {
    try {
      const { error } = await supabase.from('estimates').update({ status }).eq('id', est.id)
      if (error) throw error
      await fetchEstimates(); showToast(status === 'sent' ? 'Marked sent ✓' : status === 'declined' ? 'Marked declined ✓' : 'Updated ✓')
    } catch (e) { showToast('Failed to update estimate', 'error') }
  }
  const acceptEstimate = async (est) => {
    if (!window.confirm('Accept this estimate and create a job from it?')) return
    setLoading(true)
    try {
      const items = Array.isArray(est.items) ? est.items : []
      const materials = items.filter(it => it.kind === 'materials').reduce((s, it) => s + estItemAmount(it), 0)
      const labor = items.filter(it => it.kind === 'labor').reduce((s, it) => s + estItemAmount(it), 0)
      // Contract price = the PRE-TAX subtotal. Sales tax is collected for the state,
      // not revenue, so it must never be counted as profit or job budget (the old code
      // used the tax-inclusive total, which booked the entire tax amount as profit).
      // Profit target = the non-materials/non-labor "Other" lines (markup / overhead).
      const subtotal = estSubtotal(items)
      const profit = Math.max(subtotal - materials - labor, 0)
      const { data: proj, error } = await supabase.from('projects').insert({
        owner_id: profile.id, name: est.title || (est.client_name ? est.client_name + ' — job' : 'New job'),
        client_name: est.client_name, client_phone: est.client_phone || null, client_email: est.client_email || null,
        budget: roundCents(subtotal), materials_budget: roundCents(materials), labor_budget: roundCents(labor),
        profit_target: roundCents(profit), stage: 'start'
      }).select().single()
      if (error) throw error
      track(EV.JOB_CREATED, { source: 'estimate' })
      await supabase.from('estimates').update({ status: 'accepted', project_id: proj ? proj.id : null }).eq('id', est.id)
      await fetchEstimates(); await fetchProjects()
      showToast('Job created from estimate ✓')
    } catch (e) { showToast('Failed to accept estimate', 'error') }
    setLoading(false)
  }
  const deleteEstimate = async (est) => {
    if (!window.confirm('Delete this estimate?')) return
    try {
      const { error } = await supabase.from('estimates').delete().eq('id', est.id)
      if (error) throw error
      await fetchEstimates(); showToast('Estimate deleted ✓')
    } catch (e) { showToast('Failed to delete estimate', 'error') }
  }

  // ---- Compliance (insurance / license) ----
  const addCompliance = async () => {
    if (!complianceForm.name) return setInlineError('Add a name')
    setLoading(true); setInlineError('')
    try {
      const { error } = await supabase.from('compliance_items').insert({ owner_id: profile.id, kind: complianceForm.kind, name: complianceForm.name, reference: complianceForm.reference || null, expires_on: complianceForm.expires_on || null, notes: complianceForm.notes || null })
      if (error) throw error
      setShowNewCompliance(false); setComplianceForm({ kind: 'insurance', name: '', reference: '', expires_on: '', notes: '' })
      await fetchCompliance(); showToast('Saved ✓')
    } catch (e) { setInlineError('Failed to save. Try again.') }
    setLoading(false)
  }
  const deleteCompliance = async (item) => {
    if (!window.confirm('Delete this item?')) return
    try { const { error } = await supabase.from('compliance_items').delete().eq('id', item.id); if (error) throw error; await fetchCompliance(); showToast('Deleted ✓') } catch (e) { showToast('Failed to delete', 'error') }
  }

  // ---- Warranties / callbacks ----
  const addWarranty = async () => {
    if (!warrantyForm.description) return setInlineError('Describe the callback')
    setLoading(true); setInlineError('')
    try {
      const { error } = await supabase.from('warranties').insert({ owner_id: profile.id, project_id: warrantyForm.project_id || null, description: warrantyForm.description, status: warrantyForm.status, due_on: warrantyForm.due_on || null })
      if (error) throw error
      setShowNewWarranty(false); setWarrantyForm({ project_id: '', description: '', status: 'open', due_on: '' })
      await fetchWarranties(); showToast('Saved ✓')
    } catch (e) { setInlineError('Failed to save. Try again.') }
    setLoading(false)
  }
  const cycleWarrantyStatus = async (w) => {
    const next = w.status === 'open' ? 'scheduled' : w.status === 'scheduled' ? 'closed' : 'open'
    try { const { error } = await supabase.from('warranties').update({ status: next }).eq('id', w.id); if (error) throw error; await fetchWarranties() } catch (e) { showToast('Failed to update', 'error') }
  }
  const deleteWarranty = async (w) => {
    if (!window.confirm('Delete this callback?')) return
    try { const { error } = await supabase.from('warranties').delete().eq('id', w.id); if (error) throw error; await fetchWarranties(); showToast('Deleted ✓') } catch (e) { showToast('Failed to delete', 'error') }
  }

  // ---- Permits & inspections (per job) ----
  const addPermit = async () => {
    if (!permitForm.name) return setInlineError('Name the permit')
    setLoading(true); setInlineError('')
    try {
      const { error } = await supabase.from('permits').insert({ owner_id: profile.id, project_id: selectedProject.id, name: permitForm.name, status: permitForm.status, permit_number: permitForm.permit_number || null, inspection_on: permitForm.inspection_on || null, notes: permitForm.notes || null })
      if (error) throw error
      setShowNewPermit(false); setPermitForm({ name: '', status: 'applied', permit_number: '', inspection_on: '', notes: '' })
      await refetchDetail('permits', setPermits, 'created_at', false); showToast('Permit added ✓')
    } catch (e) { setInlineError('Failed to add. Try again.') }
    setLoading(false)
  }
  const cyclePermitStatus = async (p) => {
    const order = ['applied', 'approved', 'inspection', 'passed', 'failed']
    const next = order[(order.indexOf(p.status) + 1) % order.length]
    try { const { error } = await supabase.from('permits').update({ status: next }).eq('id', p.id); if (error) throw error; await refetchDetail('permits', setPermits, 'created_at', false) } catch (e) { showToast('Failed to update', 'error') }
  }
  const deletePermit = async (p) => {
    if (!window.confirm('Delete this permit?')) return
    try { const { error } = await supabase.from('permits').delete().eq('id', p.id); if (error) throw error; await refetchDetail('permits', setPermits, 'created_at', false); showToast('Deleted ✓') } catch (e) { showToast('Failed to delete', 'error') }
  }

  // ---- Email a quote / invoice to the client (opens their mail app, prefilled) ----
  const emailEstimate = (est) => {
    const items = Array.isArray(est.items) ? est.items : []
    const lines = items.map(it => `• ${it.description}: ${it.qty} × $${(Number(it.unit_price) || 0).toFixed(2)} = $${estItemAmount(it).toFixed(2)}`).join('\n')
    const tax = taxAmount(items, est.tax_rate, est.tax_mode)
    const total = estimateTotal(items, est.tax_rate, est.tax_mode)
    // Only break out subtotal/tax when there IS tax — a capital-improvement job
    // shows one clean number instead of a confusing "Tax: $0.00" line.
    const totals = tax > 0
      ? `Subtotal: $${estSubtotal(items).toFixed(2)}\nSales tax: $${tax.toFixed(2)}\nTotal: $${total.toFixed(2)}`
      : `Total: $${total.toFixed(2)}`
    const subject = `Estimate${est.title ? ': ' + est.title : ''}`
    const body = `Hi ${est.client_name || ''},\n\nHere's your estimate${est.title ? ' for ' + est.title : ''}:\n\n${lines}\n\n${totals}${est.notes ? '\n\n' + est.notes : ''}\n\nReply to approve and we'll get on the schedule.\n\nThanks,\n${profile.company_name || profile.full_name || ''}`
    window.location.href = `mailto:${est.client_email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }
  const emailInvoice = (inv) => {
    const job = inv.projects ? inv.projects.name : ''
    const to = inv.projects ? (inv.projects.client_email || '') : ''
    const subject = `Invoice${inv.label ? ': ' + inv.label : ''}${job ? ' — ' + job : ''}`
    const body = `Hi${inv.projects && inv.projects.client_name ? ' ' + inv.projects.client_name : ''},\n\n${inv.label || 'Invoice'}${job ? ' for ' + job : ''}: $${Number(inv.amount || 0).toFixed(2)}${inv.due_date ? '\nDue: ' + new Date(inv.due_date + 'T00:00:00').toLocaleDateString() : ''}${inv.payment_link ? '\n\nPay online: ' + inv.payment_link : ''}\n\nThank you,\n${profile.company_name || profile.full_name || ''}`
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  const addInvoice = async () => {
    if (!invoiceForm.project_id || !invoiceForm.amount) return setInlineError('Pick a job and enter an amount')
    setLoading(true); setInlineError('')
    try {
      const { error } = await supabase.from('invoices').insert({
        owner_id: profile.id, project_id: invoiceForm.project_id,
        label: invoiceForm.label || 'Invoice', amount: parseFloat(invoiceForm.amount || 0),
        issued_date: invoiceForm.issued_date || todayLocal(),
        due_date: invoiceForm.due_date || null, notes: invoiceForm.notes || null, payment_link: invoiceForm.payment_link || null, status: 'unpaid'
      })
      if (error) throw error
      setShowNewInvoice(false); setInvoiceForm({ project_id: '', label: '', amount: '', issued_date: '', due_date: '', notes: '', payment_link: '' })
      await fetchInvoices(); showToast('Invoice created ✓')
    } catch (e) { setInlineError('Failed to create invoice. Try again.') }
    setLoading(false)
  }
  const markInvoicePaid = async (inv) => {
    setLoading(true)
    try {
      const { error } = await supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', inv.id)
      if (error) throw error
      await fetchInvoices(); showToast('Marked paid ✓')
    } catch (e) { showToast('Failed to update invoice', 'error') }
    setLoading(false)
  }
  const deleteInvoice = async (inv) => {
    if (!window.confirm('Delete this invoice?')) return
    try {
      const { error } = await supabase.from('invoices').delete().eq('id', inv.id)
      if (error) throw error
      await fetchInvoices(); showToast('Invoice deleted ✓')
    } catch (e) { showToast('Failed to delete invoice', 'error') }
  }

  const createJob = async () => {
    if (!jobForm.name) return setInlineError('Job name is required')
    // Say it in plain English BEFORE the database says it in SQL. The RLS
    // policy is the real gate, but a raw "new row violates row-level security"
    // is not something to show a contractor.
    if (!canAddJob) {
      return setInlineError(
        `You're on the free plan — one job at a time. Finish “${activeProjects[0] ? activeProjects[0].name : 'your current job'}” to start another, or subscribe to run as many as you want.`
      )
    }
    setLoading(true)
    setInlineError('')
    try {
      const total = computeContractPrice(jobForm.materials_budget, jobForm.labor_budget, jobForm.profit_target)
      const { error } = await supabase.from('projects').insert({
        owner_id: profile.id, name: jobForm.name, client_name: jobForm.client_name,
        client_phone: jobForm.client_phone || null, client_email: jobForm.client_email || null, client_address: jobForm.client_address || null,
        budget: total, materials_budget: parseFloat(jobForm.materials_budget || 0),
        labor_budget: parseFloat(jobForm.labor_budget || 0), profit_target: parseFloat(jobForm.profit_target || 0),
        stage: 'start'
      })
      if (error) throw error
      track(EV.JOB_CREATED, { source: 'manual' })
      setShowNewJob(false)
      setJobForm({ name: '', client_name: '', client_phone: '', client_email: '', client_address: '', materials_budget: '', labor_budget: '', profit_target: '' })
      await fetchProjects()
      showToast('Job created ✓')
    } catch (e) {
      setInlineError('Failed to create job. Try again.')
    }
    setLoading(false)
  }

  const scanReceipt = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setScanning(true)
    setScanResult(null)
    setScanError('')
    try {
      const fileName = `${profile.id}/${Date.now()}_${file.name}`
      const { error: uploadError } = await supabase.storage.from('receipts').upload(fileName, file)
      if (uploadError) throw uploadError
      // Store the storage PATH (not a public URL); the bucket is private and the
      // image is viewed via a short-lived signed URL in PhotoViewer.
      setReceiptForm(f => ({ ...f, photo_url: fileName }))

      const reader = new FileReader()
      reader.onload = async (event) => {
        const base64 = event.target.result.split(',')[1]
        try {
          const { data: { session } } = await supabase.auth.getSession()
          const response = await fetch('/api/scan-receipt', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session ? { Authorization: `Bearer ${session.access_token}` } : {})
            },
            body: JSON.stringify({ imageBase64: base64, mediaType: file.type })
          })
          const result = await response.json().catch(() => ({}))
          if (result.store || result.amount) setScanResult(result)
          else setScanError(result.error || "Couldn't read this receipt — fill in the fields below.")
        } catch { setScanError("Couldn't read this receipt — fill in the fields below.") }
        setScanning(false)
      }
      reader.readAsDataURL(file)
    } catch (e) {
      setScanError("Photo upload failed. Fill in the fields manually.")
      setScanning(false)
    }
  }

  const confirmScan = () => {
    if (!scanResult) return
    // scan-receipt returns store, amount, tax, total and date. `amount` is the
    // PRE-TAX subtotal and `tax` is the sales tax — the endpoint reconciles the
    // two so amount + tax always equals the total the card was charged. That
    // matters because fetchSpend books cost = amount + tax_amount: copying a
    // grand total in here alongside the tax charges the job its sales tax twice.
    // `total` is display-only and is deliberately not written to the form.
    // Only overwrite tax when the scan actually found one (never blank out a
    // number the owner typed).
    setReceiptForm(f => ({
      ...f,
      store: scanResult.store || f.store,
      amount: scanResult.amount || f.amount,
      tax: (scanResult.tax != null && scanResult.tax !== '' && !/^none$/i.test(String(scanResult.tax)))
        ? scanResult.tax
        : f.tax,
      purchase_date: (scanResult.date && /^\d{4}-\d{2}-\d{2}$/.test(scanResult.date))
        ? scanResult.date
        : f.purchase_date
    }))
    setScanUsed(true)
    setScanResult(null)
  }

  const addReceipt = async () => {
    if (!receiptForm.amount) return setInlineError('Amount is required')
    setLoading(true)
    setInlineError('')
    try {
      const amount = parseFloat(receiptForm.amount)
      const { error } = await supabase.from('receipts').insert({
        project_id: selectedProject.id, owner_id: profile.id,
        description: receiptForm.description, store: receiptForm.store,
        amount, tax_amount: parseFloat(receiptForm.tax || 0),
        category: receiptForm.category, photo_url: receiptForm.photo_url || null,
        // The day the money was actually spent — this, not created_at, is what
        // buckets the receipt into a tax year. Blank = today in the OWNER's
        // timezone (toISOString() would roll over to tomorrow after 8pm ET).
        purchase_date: receiptForm.purchase_date || localToday()
      })
      if (error) throw error
      // Category is a fixed enum and scanned is a boolean — shape, not content.
      track(EV.RECEIPT_ADDED, { category: receiptForm.category, scanned: scanUsed })
      setShowNewReceipt(false)
      setReceiptForm({ description: '', store: '', amount: '', tax: '', category: 'materials', photo_url: '', purchase_date: '' })
      setScanResult(null); setScanError(''); setScanUsed(false)
      await refetchDetail('receipts', setReceipts, 'created_at', false)
      await fetchProjects()
      showToast('Receipt saved ✓')
    } catch (e) {
      setInlineError('Failed to save receipt. Try again.')
    }
    setLoading(false)
  }

  // Called from two places now: inside a job (the job is implied) and from the
  // crew week grid (the job has to be picked). A shift with no job can't exist
  // — the crew's phone shows them WHERE to be, not just when.
  const addSchedule = async () => {
    const projectId = selectedProject ? selectedProject.id : scheduleForm.project_id
    if (!scheduleForm.worker_id || !scheduleForm.scheduled_date) return setInlineError('Worker and date are required')
    if (!projectId) return setInlineError('Pick which job this shift is on')
    setLoading(true)
    setInlineError('')
    try {
      const { error } = await supabase.from('schedule_entries').insert({
        owner_id: profile.id, worker_id: scheduleForm.worker_id,
        project_id: projectId, task_description: scheduleForm.task_description,
        scheduled_date: scheduleForm.scheduled_date, start_time: scheduleForm.start_time, end_time: scheduleForm.end_time
      })
      if (error) throw error
      setShowNewSchedule(false)
      setScheduleForm({ worker_id: '', project_id: '', task_description: '', scheduled_date: '', start_time: '', end_time: '' })
      if (selectedProject) {
        await refetchDetail('schedule_entries', setScheduleEntries, 'scheduled_date', true, '*, profiles!schedule_entries_worker_id_fkey(full_name)')
      } else {
        // Jump the grid to the week the shift landed in, so a shift scheduled
        // for next Tuesday doesn't vanish the moment you save it.
        const wk = weekStartKey(scheduleForm.scheduled_date + 'T00:00:00')
        if (wk !== crewWeekStart) setCrewWeekStart(wk)
        else await fetchCrewWeek(crewWeekStart)
        fetchUpcomingSchedule()
      }
      showToast('Scheduled ✓')
    } catch (e) {
      setInlineError('Failed to save schedule. Try again.')
    }
    setLoading(false)
  }

  const deleteSchedule = async (entry) => {
    if (!window.confirm('Remove this shift from the schedule?')) return
    try {
      const { error } = await supabase.from('schedule_entries').delete().eq('id', entry.id)
      if (error) throw error
      setCrewWeek(list => list.filter(s => s.id !== entry.id))
      setScheduleEntries(list => list.filter(s => s.id !== entry.id))
      fetchUpcomingSchedule()
      showToast('Shift removed')
    } catch (e) {
      console.error('Delete schedule failed:', e)
      showToast('Could not remove that shift. Try again.', 'error')
    }
  }

  const assignWorkerToProject = async (workerId) => {
    if (!assignProjectId) return setInlineError('Select a job first')
    setLoading(true)
    setInlineError('')
    try {
      const { error } = await supabase.from('project_workers').insert({ worker_id: workerId, project_id: assignProjectId })
      if (error && error.code !== '23505') throw error
      const jobName = projects.find(p => p.id === assignProjectId)?.name || 'job'
      setShowAssignWorker(null); setAssignProjectId('')
      setAssignedWorkerIds(prev => prev.includes(workerId) ? prev : [...prev, workerId])
      showToast(`Assigned to ${jobName} — they can clock in now ✓`)
    } catch (e) {
      setInlineError('Failed to assign worker. Try again.')
    }
    setLoading(false)
  }

  const saveWorkerRate = async () => {
    setLoading(true)
    setInlineError('')
    try {
      const { error } = await supabase.from('profiles').update({ hourly_rate: parseFloat(editRate || 0) }).eq('id', showEditRate.id)
      if (error) throw error
      setShowEditRate(null); setEditRate('')
      await fetchWorkers()
      showToast('Rate updated ✓')
    } catch (e) {
      setInlineError('Failed to update rate. Try again.')
    }
    setLoading(false)
  }

  // ---- Social proof -------------------------------------------------------
  // The only honest moment to ask a contractor for a quote is the second the
  // app just told him a real job made money. So that's the ONLY moment we ask:
  // real job (never the demo), closed in the black, once per account, and never
  // again once he's answered either way. Everything here is best-effort — a
  // failed ask must never get in the way of finishing a job.
  const TESTIMONIAL_KEY = `jobtally_testimonial_asked_${profile.id}`

  const maybeAskForTestimonial = async (project) => {
    try {
      if (localStorage.getItem(TESTIMONIAL_KEY)) return
    } catch { /* storage blocked — the DB check below is the real gate */ }
    if (profitOf(project) <= 0) return
    try {
      // Authoritative check: already gave us one on another device?
      const { data, error } = await supabase.from('testimonials').select('id').eq('owner_id', profile.id).limit(1)
      if (error || (data && data.length)) return
    } catch { return }
    // Let the "Job completed ✓" toast land first — the ask should feel like a
    // reaction to the good news, not an interruption of it.
    setTimeout(() => {
      setTestimonialForm({
        quote: '', author_name: profile.full_name || '', company_name: profile.company_name || '',
        city: '', rating: 5, permission: false,
      })
      setTestimonialAsk({ jobName: project.name, profit: profitOf(project) })
      track(EV.TESTIMONIAL_PROMPTED)
    }, 1400)
  }

  const closeTestimonial = (submitted) => {
    // Marked asked either way — a "no" is an answer, and we don't nag.
    try { localStorage.setItem(TESTIMONIAL_KEY, submitted ? 'submitted' : 'dismissed') } catch {}
    if (!submitted) track(EV.TESTIMONIAL_DISMISSED)
    setTestimonialAsk(null)
    setInlineError('')
  }

  const submitTestimonial = async () => {
    const quote = testimonialForm.quote.trim()
    // Matches the CHECK constraint on public.testimonials so a too-short quote
    // fails here with a readable message instead of a raw Postgres error.
    if (quote.length < 10) return setInlineError('Give it a sentence or two (10 characters minimum).')
    if (quote.length > 600) return setInlineError('Keep it under 600 characters.')
    if (!testimonialForm.permission) return setInlineError('Tick the box if we can use it — we will not publish it otherwise.')
    setTestimonialSaving(true)
    setInlineError('')
    try {
      const { error } = await supabase.from('testimonials').insert({
        owner_id: profile.id,
        quote,
        author_name: testimonialForm.author_name.trim() || null,
        company_name: testimonialForm.company_name.trim() || null,
        city: testimonialForm.city.trim() || null,
        rating: testimonialForm.rating || null,
        permission_granted: true,
        // approved stays false — nothing reaches the landing page until it's
        // reviewed by hand in Supabase. The insert policy enforces this too.
        approved: false,
      })
      if (error) throw error
      track(EV.TESTIMONIAL_SUBMITTED, { rating: testimonialForm.rating })
      closeTestimonial(true)
      showToast('Thank you — that means a lot 🙏')
    } catch (e) {
      setInlineError('Could not send it. Try again.')
    }
    setTestimonialSaving(false)
  }

  const advanceStage = async (project) => {
    const stages = ['start', 'mid', 'end']
    const current = stages.indexOf(project.stage)
    if (current >= 2) return
    try {
      const next = stages[current + 1]
      const { error } = await supabase.from('projects').update({
        stage: next, ...(next === 'end' ? { completed_at: new Date().toISOString() } : {})
      }).eq('id', project.id)
      if (error) throw error
      await fetchProjects()
      setSelectedProject(prev => prev ? { ...prev, stage: next } : null)
      showToast(next === 'end' ? 'Job completed ✓' : 'Stage advanced ✓')
      if (next === 'end' && !project.is_sample) {
        // Whether it made money, not how much — a dollar figure is the owner's
        // business, the boolean is ours (it's the number the app exists to show).
        track(EV.JOB_COMPLETED, { profitable: profitOf(project) > 0 })
        maybeAskForTestimonial(project)
      }
    } catch (e) {
      showToast('Failed to advance stage', 'error')
    }
  }

  // Header status-pill tap: advance the job forward (Not started → In progress →
  // Done), or once it's Done offer to reopen it. Mirrors the clickable permit /
  // warranty pills so the pill is the obvious stage control (T4.1).
  const cycleStage = (project) => {
    if (project.stage === 'end') return reopenJob(project)
    return advanceStage(project)
  }

  const exportReportCSV = () => {
    const header = ['Job', 'Client', 'Completed', 'Revenue', 'Materials', 'Labor', 'Other', 'Profit', 'Margin %']
    const rows = [header]
    // Round every cell to cents and total THOSE rounded values, so the TOTALS
    // row always equals the sum of the printed rows (no off-by-a-cent on a tax doc).
    const r2 = roundCents
    const tot = { rev: 0, mat: 0, lab: 0, oth: 0, prof: 0 }
    reportJobs.forEach(p => {
      const s = spendOf(p.id)
      const rev = r2(contractOf(p)), mat = r2(s.materials), lab = r2(s.labor), oth = r2(s.other)
      const profit = r2(profitOf(p))
      const margin = computeMargin(profit, contractOf(p))
      tot.rev += rev; tot.mat += mat; tot.lab += lab; tot.oth += oth; tot.prof += profit
      rows.push([
        p.name || '', p.client_name || '',
        p.completed_at ? new Date(p.completed_at).toLocaleDateString() : '',
        rev.toFixed(2), mat.toFixed(2), lab.toFixed(2),
        oth.toFixed(2), profit.toFixed(2), margin
      ])
    })
    rows.push([])
    rows.push(['TOTALS', '', '', r2(tot.rev).toFixed(2), r2(tot.mat).toFixed(2), r2(tot.lab).toFixed(2), r2(tot.oth).toFixed(2), r2(tot.prof).toFixed(2), ''])
    const csv = rows.map(r => r.map(cell => {
      const v = String(cell)
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
    }).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jobtally-${reportYear}-tax-report.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('Report exported ✓')
  }

  // downloadCsv extracted to ../utils/csv (imported above).

  const exportQboInvoices = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('invoices')
        .select('*, projects(name, client_name)')
        .eq('owner_id', profile.id)
        .order('issued_date', { ascending: true })
      if (error) throw error
      if (!data || !data.length) { showToast('No invoices to export', 'error'); setLoading(false); return }
      downloadCsv(buildQboInvoicesCsv(data), 'jobtally-quickbooks-invoices.csv')
      showToast('QuickBooks invoices exported ✓')
    } catch (e) { showToast('Export failed', 'error') }
    setLoading(false)
  }
  const exportQboCustomers = () => {
    // realProjects, not projects — the demo client must never be pushed into
    // the owner's real QuickBooks customer list.
    const rows = buildQboCustomersCsv(realProjects)
    if (rows.length <= 1) { showToast('No customers to export', 'error'); return }
    downloadCsv(rows, 'jobtally-quickbooks-customers.csv')
    showToast('QuickBooks customers exported ✓')
  }

  // "Download everything I have" — the whole account, one file.
  //
  // Almost no owner_id / project_id filters in here, on purpose. Nearly every
  // table carries owner-scoped RLS, so a plain select returns exactly the rows
  // this owner is allowed to see and nothing else. Scoping it a second time by
  // hand would only create a way for the two rules to disagree — and an export
  // that quietly drops a table is worse than no export, because it looks
  // complete. RLS is the app's own definition of "your data"; this uses it.
  //
  // THE EXCEPTION, and it matters: "what RLS lets you read" and "your data" are
  // not always the same set. A table with a deliberate public-read policy —
  // testimonials, whose approved rows are visible to everyone so the marketing
  // site can quote them — would pour other customers' rows into this file. Any
  // table like that carries an explicit filter column as its third entry in
  // EXPORT_TABLES. Before adding a table here, read its policies and ask
  // whether SELECT is scoped to this owner or wider than them.
  const exportEverything = async () => {
    setLoading(true)
    try {
      const rows = []
      rows.push(['JOBTALLY — EVERYTHING ON YOUR ACCOUNT'])
      rows.push(['Company', profile.company_name || ''])
      rows.push(['Account', profile.email || ''])
      rows.push(['Generated', new Date().toLocaleString()])
      rows.push([])
      rows.push(['This is every record on your account, one section per kind.'])
      rows.push(['Photos and documents have a "download_link" column. Those links open the real file, and they expire 7 days after this file was made — re-download this export any time to get fresh ones.'])
      rows.push([])

      let failed = 0
      for (const [table, label, ownerCol] of EXPORT_TABLES) {
        let data
        try {
          data = await fetchAllRows((from, to) => {
            const q = supabase.from(table).select('*')
            // Only set on tables whose SELECT policy is wider than this owner —
            // see the note on EXPORT_TABLES.
            return (ownerCol ? q.eq(ownerCol, profile.id) : q).range(from, to)
          })
        } catch (e) {
          // Never let one bad table silently shrink the export — say so in the
          // file itself, where the owner (or their accountant) will see it.
          rows.push([`=== ${label.toUpperCase()} ===`])
          rows.push([`Could not be read — email support@getjobtally.com and we'll send this part.`])
          rows.push([])
          failed++
          continue
        }
        rows.push([`=== ${label.toUpperCase()} ===`, `${(data || []).length} record${(data || []).length === 1 ? '' : 's'}`])
        if (!data || !data.length) {
          rows.push(['(none)'])
          rows.push([])
          continue
        }
        // Turn the stored file reference into something the owner can actually
        // open. photo_url / file_url hold a PATH inside the private `receipts`
        // bucket, not a URL — the bucket stopped being public in
        // FIX-DATABASE-4. Exporting the raw column handed people a string that
        // looks like a link, isn't one, and 404s: the export claimed to give
        // them their photos and gave them nothing. Sign them instead.
        // 7 days is Supabase's practical ceiling for a signed URL and it's the
        // right trade here — long enough to hand the file to an accountant,
        // short enough that a CSV emailed around isn't a permanent public key
        // to every receipt photo in the business.
        const linkCol = table === 'job_documents' ? 'file_url' : table === 'job_photos' ? 'photo_url' : null
        const links = new Map()
        if (linkCol) {
          // Rows written before the bucket went private still hold a full URL;
          // those are already openable and must not be re-signed as if they
          // were paths.
          const paths = data.map(r => r[linkCol]).filter(u => u && !/^https?:\/\//.test(u))
          if (paths.length) {
            try {
              const { data: signed } = await supabase.storage.from('receipts').createSignedUrls(paths, 604800)
              ;(signed || []).forEach(s => { if (s && s.path && s.signedUrl) links.set(s.path, s.signedUrl) })
            } catch { /* fall through — the path column is still exported below */ }
          }
        }

        // Union of every key present, so a row with an extra column can't shift
        // every following cell one place to the left.
        const cols = []
        data.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k) }))
        if (linkCol) cols.push('download_link')
        rows.push(cols)
        data.forEach(r => rows.push(cols.map(c => {
          if (c === 'download_link') {
            const raw = r[linkCol]
            if (!raw) return ''
            if (/^https?:\/\//.test(raw)) return raw
            return links.get(raw) || 'link unavailable — email support@getjobtally.com'
          }
          const v = r[c]
          if (v == null) return ''
          return typeof v === 'object' ? JSON.stringify(v) : String(v)
        })))
        rows.push([])
      }

      downloadCsv(rows, `jobtally-my-data-${todayLocal()}.csv`)
      showToast(failed ? `Downloaded — ${failed} part(s) unavailable` : 'Downloaded ✓', failed ? 'error' : undefined)
    } catch (e) {
      showToast('Could not build the file — try again', 'error')
    }
    setLoading(false)
  }

  // A full, accountant-ready summary for the year: income from completed jobs,
  // deductible expenses broken out by category, labor, mileage, and sales tax.
  const exportTaxPack = async () => {
    setLoading(true)
    try {
      const yStart = `${reportYear}-01-01`
      const yEndDate = `${reportYear}-12-31`
      const yEndTs = `${yEndDate}T23:59:59`
      // Real jobs only. The seeded demo job carries fabricated receipts and
      // labor — putting those in front of an accountant would be a filing error
      // with the owner's name on it, so it is stripped from every side of this
      // export (income, expenses, labor).
      const sampleIds = new Set(projects.filter(p => p.is_sample).map(p => p.id))
      const projectIds = projects.filter(p => !p.is_sample).map(p => p.id)
      // Page every source past the 1000-row cap — a full year of receipts, trips,
      // or shifts on a busy account exceeds it, and a silent undercount here would
      // understate deductions on the accountant-facing tax pack.
      const [rawRcpts, miles, times] = await Promise.all([
        // Bucket by purchase_date (the date ON the receipt), not created_at.
        // A December receipt entered in January belongs to December's return.
        // purchase_date is NOT NULL and backfilled from created_at, so no row
        // can silently fall out of this range.
        fetchAllRows((from, to) => supabase.from('receipts').select('category, amount, tax_amount, purchase_date, project_id').eq('owner_id', profile.id).gte('purchase_date', yStart).lte('purchase_date', yEndDate).range(from, to)),
        fetchAllRows((from, to) => supabase.from('mileage_entries').select('miles, rate, trip_date').eq('owner_id', profile.id).gte('trip_date', yStart).lte('trip_date', yEndDate).range(from, to)),
        projectIds.length
          ? fetchAllRows((from, to) => supabase.from('time_entries').select('labor_cost, clocked_in_at').in('project_id', projectIds).not('clocked_out_at', 'is', null).gte('clocked_in_at', yStart).lte('clocked_in_at', yEndTs).range(from, to))
          : Promise.resolve([])
      ])
      const r2 = roundCents
      // Receipts come back by owner, not by job, so the demo job's are filtered
      // here rather than in the query.
      const rcpts = (rawRcpts || []).filter(r => !sampleIds.has(r.project_id))
      const byCat = {}
      let salesTax = 0
      ;(rcpts || []).forEach(r => {
        byCat[r.category] = (byCat[r.category] || 0) + (r.amount || 0)
        salesTax += r.tax_amount || 0
      })
      const totalMiles = (miles || []).reduce((s, m) => s + (m.miles || 0), 0)
      const mileageDeduction = (miles || []).reduce((s, m) => s + (m.miles || 0) * (m.rate || 0), 0)
      const laborTotal = (times || []).reduce((s, t) => s + (t.labor_cost || 0), 0)
      const expensesTotal = Object.values(byCat).reduce((s, v) => s + v, 0)
      const income = reportJobs.reduce((s, p) => s + contractOf(p), 0)
      const deductions = expensesTotal + laborTotal + mileageDeduction

      const rows = []
      rows.push(['JOBTALLY TAX PACK', String(reportYear)])
      rows.push(['Generated', new Date().toLocaleDateString()])
      rows.push([])
      rows.push(['INCOME — completed jobs'])
      rows.push(['Job', 'Client', 'Completed', 'Revenue'])
      reportJobs.forEach(p => rows.push([p.name || '', p.client_name || '', p.completed_at ? new Date(p.completed_at).toLocaleDateString() : '', r2(contractOf(p)).toFixed(2)]))
      rows.push(['', '', 'TOTAL INCOME', r2(income).toFixed(2)])
      rows.push([])
      rows.push(['DEDUCTIBLE EXPENSES — by category'])
      rows.push(['Category', 'Amount'])
      Object.keys(byCat).sort().forEach(c => rows.push([CATEGORY_LABELS[c] || c, r2(byCat[c]).toFixed(2)]))
      rows.push(['Labor / wages', r2(laborTotal).toFixed(2)])
      rows.push([`Mileage (${totalMiles.toLocaleString()} mi)`, r2(mileageDeduction).toFixed(2)])
      rows.push(['TOTAL DEDUCTIONS', r2(deductions).toFixed(2)])
      rows.push([])
      rows.push(['Sales tax paid on purchases (info)', r2(salesTax).toFixed(2)])
      rows.push([])
      rows.push(['SUMMARY'])
      rows.push(['Total income', r2(income).toFixed(2)])
      rows.push(['Total deductions', r2(deductions).toFixed(2)])
      rows.push(['Net (income − deductions)', r2(income - deductions).toFixed(2)])
      rows.push([])
      rows.push(['NOTE: Summary for your accountant — not a tax filing. Mileage uses the standard rate; do not also deduct actual vehicle costs for those same miles.'])

      downloadCsv(rows, `jobtally-${reportYear}-tax-pack.csv`)
      showToast('Tax Pack exported ✓')
    } catch (e) {
      showToast('Failed to export Tax Pack', 'error')
    }
    setLoading(false)
  }

  const deleteReceipt = async (receipt) => {
    if (!window.confirm('Delete this receipt? This cannot be undone.')) return
    try {
      const { error } = await supabase.from('receipts').delete().eq('id', receipt.id)
      if (error) throw error
      setPhotoViewer(null)
      await refetchDetail('receipts', setReceipts, 'created_at', false)
      await fetchProjects()
      showToast('Receipt deleted ✓')
    } catch (e) {
      showToast('Failed to delete receipt', 'error')
    }
  }

  const deleteTimeEntry = async (entry) => {
    if (!window.confirm('Delete this time entry? Labor cost recalculates automatically.')) return
    try {
      const { error } = await supabase.from('time_entries').delete().eq('id', entry.id)
      if (error) throw error
      await refetchDetail('time_entries', setTimeEntries, 'clocked_in_at', false, '*, profiles(full_name)')
      await fetchProjects()
      showToast('Time entry deleted ✓')
    } catch (e) {
      showToast('Failed to delete time entry', 'error')
    }
  }

  const reopenJob = async (project) => {
    if (!window.confirm('Reopen this completed job?')) return
    try {
      const { error } = await supabase.from('projects').update({ stage: 'mid', completed_at: null }).eq('id', project.id)
      if (error) throw error
      await fetchProjects()
      setSelectedProject(prev => prev ? { ...prev, stage: 'mid', completed_at: null } : null)
      showToast('Job reopened ✓')
    } catch (e) {
      showToast('Failed to reopen job', 'error')
    }
  }

  const openEditJob = () => {
    setEditJobForm({
      name: selectedProject.name || '',
      client_name: selectedProject.client_name || '',
      client_phone: selectedProject.client_phone || '',
      client_email: selectedProject.client_email || '',
      client_address: selectedProject.client_address || '',
      materials_budget: selectedProject.materials_budget || '',
      labor_budget: selectedProject.labor_budget || '',
      profit_target: selectedProject.profit_target || ''
    })
    setInlineError('')
    setShowEditJob(true)
  }

  const saveEditJob = async () => {
    if (!editJobForm.name) return setInlineError('Job name is required')
    setLoading(true)
    setInlineError('')
    try {
      const materials = parseFloat(editJobForm.materials_budget || 0)
      const labor = parseFloat(editJobForm.labor_budget || 0)
      const profit = parseFloat(editJobForm.profit_target || 0)
      const total = materials + labor + profit
      // If the owner left every budget bucket blank (e.g. an assistant-created
      // job never had buckets set), DON'T overwrite the contract to $0 — leave
      // budget + buckets untouched and only save the other fields they edited.
      const bucketsBlank = ['materials_budget', 'labor_budget', 'profit_target']
        .every(k => editJobForm[k] === '' || editJobForm[k] == null)
      const updated = {
        name: editJobForm.name, client_name: editJobForm.client_name,
        client_phone: editJobForm.client_phone || null, client_email: editJobForm.client_email || null, client_address: editJobForm.client_address || null,
        ...(bucketsBlank ? {} : { materials_budget: materials, labor_budget: labor, profit_target: profit, budget: total })
      }
      const { error } = await supabase.from('projects').update(updated).eq('id', selectedProject.id)
      if (error) throw error
      setShowEditJob(false)
      await fetchProjects()
      setSelectedProject(prev => prev ? { ...prev, ...updated } : null)
      showToast('Job updated ✓')
    } catch (e) {
      setInlineError('Failed to update job. Try again.')
    }
    setLoading(false)
  }

  const getBudgetPct = (spent, budget) => budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
  const getBudgetClass = (pct) => pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : ''
  const spendOf = (pid) => spendByProject[pid] || { materials: 0, labor: 0, other: 0 }
  const coOf = (pid) => coByProject[pid] || 0
  // Contract price the client owes = base contract + approved change orders.
  const contractOf = (p) => (p.budget || 0) + coOf(p.id)
  // Profit = contract price (incl. approved change orders) minus everything spent.
  const profitOf = (p) => computeProfit(contractOf(p), spendOf(p.id))

  // The seeded demo job (src/utils/sampleJob.js, flagged is_sample) exists to
  // show a new owner what a finished job looks like. It is NOT their money, so
  // it is excluded from every total, chart, export and onboarding check below —
  // it only ever appears as its own clearly-labelled card on the Jobs tab.
  const sampleProject = projects.find(p => p.is_sample) || null
  const realProjects = sampleProject ? projects.filter(p => !p.is_sample) : projects

  const activeProjects = realProjects.filter(p => p.stage !== 'end')
  const completedProjects = realProjects.filter(p => p.stage === 'end')

  // FREE FOREVER, ONE ACTIVE JOB. The paywall no longer sits at the front door
  // (App.js lets everyone in) — it sits here, on starting a SECOND job.
  //
  // `activeProjects` is already the exact set the DB counts: real jobs (sample
  // excluded) that haven't reached stage 'end'. That match is deliberate — the
  // RLS policy in FIX-DATABASE-30 is the real gate, and if this disagreed with
  // it the owner would get a button that throws.
  //
  // Not gated when billing isn't enforced, so a dev/comp environment behaves.
  const paidNow = !billingEnforced || (sub && ['active', 'trialing', 'comp'].includes(sub.status))
  const canAddJob = canStartJob({ paid: paidNow, activeJobs: activeProjects.length })
  const projectedProfit = activeProjects.reduce((sum, p) => sum + profitOf(p), 0)
  // Active job value = the contract value of all active jobs (materials + labor
  // + profit). Shown on the at-a-glance summaries; unlike projected profit it
  // doesn't move as costs are logged. Labelled "Grand total" until JP pointed
  // out that a bare "grand total" on a dashboard reads as money SPENT.
  const grandTotal = activeProjects.reduce((sum, p) => sum + contractOf(p), 0)

  // ---- Home / Clients / Calendar derived data ----
  const owedTotal = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.amount || 0), 0)
  const openEstimateCount = estimates.filter(e => e.status !== 'accepted' && e.status !== 'declined').length
  const budgetAlerts = activeProjects.filter(p => {
    const s = spendOf(p.id)
    return getBudgetPct(s.materials, p.materials_budget) >= 80 || getBudgetPct(s.labor, p.labor_budget) >= 80
  })
  const weekEndKey = addDaysKey(dateKey(new Date()), 7)
  const thisWeekSchedule = upcomingSchedule.filter(s => s.scheduled_date && s.scheduled_date <= weekEndKey)
  const clientsMap = {}
  realProjects.forEach(p => {
    const name = (p.client_name || '').trim(); if (!name) return
    if (!clientsMap[name]) clientsMap[name] = { name, phone: '', email: '', jobs: 0, contract: 0, billed: 0, owed: 0 }
    const c = clientsMap[name]
    c.jobs += 1; c.contract += contractOf(p)
    if (!c.phone && p.client_phone) c.phone = p.client_phone
    if (!c.email && p.client_email) c.email = p.client_email
  })
  invoices.forEach(inv => {
    const name = inv.projects && inv.projects.client_name ? inv.projects.client_name.trim() : null
    if (name && clientsMap[name]) { clientsMap[name].billed += inv.amount || 0; if (inv.status !== 'paid') clientsMap[name].owed += inv.amount || 0 }
  })
  const clientsList = Object.values(clientsMap).sort((a, b) => b.contract - a.contract)

  // ---- Insights (charts) derived data ----
  const arNow = Date.now()
  const arBuckets = [
    { label: 'Current', total: 0, color: '#16A34A' },
    { label: '1–30 days', total: 0, color: '#E07B2A' },
    { label: '31–60 days', total: 0, color: '#D97706' },
    { label: '60+ days', total: 0, color: '#DC2626' },
  ]
  invoices.filter(i => i.status !== 'paid').forEach(i => {
    const due = i.due_date ? new Date(i.due_date + 'T00:00:00').getTime() : arNow
    const overdue = Math.floor((arNow - due) / 86400000)
    const b = overdue <= 0 ? 0 : overdue <= 30 ? 1 : overdue <= 60 ? 2 : 3
    arBuckets[b].total += i.amount || 0
  })
  const arTotal = arBuckets.reduce((s, b) => s + b.total, 0)
  const nowD = new Date()
  const revMonths = []
  for (let k = 5; k >= 0; k--) {
    const d = new Date(nowD.getFullYear(), nowD.getMonth() - k, 1)
    revMonths.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-US', { month: 'short' }), total: 0 })
  }
  invoices.filter(i => i.status === 'paid' && i.paid_at).forEach(i => {
    const d = new Date(i.paid_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const m = revMonths.find(x => x.key === key)
    if (m) m.total += i.amount || 0
  })
  const revMax = Math.max(1, ...revMonths.map(m => m.total))
  const estAccepted = estimates.filter(e => e.status === 'accepted').length
  const estDeclined = estimates.filter(e => e.status === 'declined').length
  const estOpen = estimates.filter(e => e.status === 'draft' || e.status === 'sent').length
  const winRate = (estAccepted + estDeclined) ? Math.round((estAccepted / (estAccepted + estDeclined)) * 100) : null
  const profitJobs = completedProjects.map(p => ({ name: p.name, profit: profitOf(p) }))
  const profitMax = Math.max(1, ...profitJobs.map(j => Math.abs(j.profit)))

  const reportYears = [new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2]
  const reportJobs = completedProjects.filter(p => p.completed_at && new Date(p.completed_at).getFullYear() === reportYear)

  // The social-proof ask. Built once here and rendered in BOTH returns below,
  // because the moment that triggers it (marking a job complete) happens inside
  // the project detail view — but the owner may hit Back before answering, and
  // the ask shouldn't vanish just because he changed screens.
  const testimonialModal = testimonialAsk && (
    <div className="modal-overlay" onClick={() => closeTestimonial(false)}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <h2>Nice — {formatCurrency(testimonialAsk.profit)} on that one</h2>
        <p style={{ fontSize: '14px', color: '#4B5563', lineHeight: '1.55', marginBottom: '14px' }}>
          You just closed <strong>{testimonialAsk.jobName}</strong> in the black. If JobTally helped,
          would you put that in a sentence? Other contractors read it before they trust us with
          their numbers.
        </p>
        <div className="input-group">
          <label>Your words</label>
          <textarea
            rows={4}
            maxLength={600}
            value={testimonialForm.quote}
            onChange={e => setTestimonialForm({ ...testimonialForm, quote: e.target.value })}
            placeholder="I never knew what a job actually made me until this. Takes 5 minutes a day."
          />
          <p style={{ fontSize: '12px', color: '#9CA3AF', textAlign: 'right', margin: '2px 2px 0' }}>{testimonialForm.quote.length}/600</p>
        </div>
        <div className="input-group">
          <label>How many stars?</label>
          <div style={{ display: 'flex', gap: '4px' }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                onClick={() => setTestimonialForm({ ...testimonialForm, rating: n })}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 3px',
                  fontSize: '28px', lineHeight: '1',
                  color: n <= testimonialForm.rating ? '#F59E0B' : '#D1D5DB',
                }}
              >★</button>
            ))}
          </div>
        </div>
        <div className="input-group">
          <label>Your name</label>
          <input value={testimonialForm.author_name} onChange={e => setTestimonialForm({ ...testimonialForm, author_name: e.target.value })} maxLength={80} placeholder="Tony R." />
        </div>
        <div className="input-group">
          <label>Company</label>
          <input value={testimonialForm.company_name} onChange={e => setTestimonialForm({ ...testimonialForm, company_name: e.target.value })} maxLength={120} placeholder="R&amp;S Remodeling" />
        </div>
        <div className="input-group">
          <label>City</label>
          <input value={testimonialForm.city} onChange={e => setTestimonialForm({ ...testimonialForm, city: e.target.value })} maxLength={80} placeholder="Troy, NY" />
        </div>
        <label style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', fontSize: '13px', color: '#374151', lineHeight: '1.5', margin: '4px 2px 14px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={testimonialForm.permission}
            onChange={e => setTestimonialForm({ ...testimonialForm, permission: e.target.checked })}
            style={{ marginTop: '2px', width: '17px', height: '17px', flexShrink: 0 }}
          />
          <span>JobTally can use this on the website. Your job numbers are never shown — only what you wrote above.</span>
        </label>
        {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
        <button className="btn-primary" onClick={submitTestimonial} disabled={testimonialSaving}>{testimonialSaving ? 'Sending…' : 'Send it'}</button>
        <button className="btn-secondary" onClick={() => closeTestimonial(false)}>Not right now</button>
      </div>
    </div>
  )

  // Scheduling is reachable from two screens now — inside a job, and from the
  // crew week grid — and those live on opposite sides of the early return
  // below. One definition rendered in both places, rather than two copies that
  // drift apart the first time somebody adds a field.
  const scheduleModal = showNewSchedule && (
    <div className="modal-overlay" onClick={() => setShowNewSchedule(false)}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <h2>Schedule Worker</h2>
        <div className="input-group"><label>Worker</label><select value={scheduleForm.worker_id} onChange={e => setScheduleForm({ ...scheduleForm, worker_id: e.target.value })}><option value="">Select worker</option>{workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}</select></div>
        {/* Only when the job isn't already implied by the screen you came from. */}
        {!selectedProject && (
          <div className="input-group"><label>Job</label><select value={scheduleForm.project_id} onChange={e => setScheduleForm({ ...scheduleForm, project_id: e.target.value })}><option value="">Select job</option>{activeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        )}
        <div className="input-group"><label>Task</label><input value={scheduleForm.task_description} onChange={e => setScheduleForm({ ...scheduleForm, task_description: e.target.value })} placeholder="Pour foundation" /></div>
        <div className="input-group"><label>Date</label><input type="date" value={scheduleForm.scheduled_date} onChange={e => setScheduleForm({ ...scheduleForm, scheduled_date: e.target.value })} /></div>
        <div className="input-group"><label>Start Time</label><input type="time" value={scheduleForm.start_time} onChange={e => setScheduleForm({ ...scheduleForm, start_time: e.target.value })} /></div>
        <div className="input-group"><label>End Time</label><input type="time" value={scheduleForm.end_time} onChange={e => setScheduleForm({ ...scheduleForm, end_time: e.target.value })} /></div>
        {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
        <button className="btn-primary" onClick={addSchedule} disabled={loading}>{loading ? 'Saving…' : 'Schedule'}</button>
        <button className="btn-secondary" onClick={() => { setShowNewSchedule(false); setInlineError('') }}>Cancel</button>
      </div>
    </div>
  )

  // PROJECT DETAIL VIEW
  if (selectedProject) {
    const sp = spendOf(selectedProject.id)
    const matPct = getBudgetPct(sp.materials, selectedProject.materials_budget)
    const labPct = getBudgetPct(sp.labor, selectedProject.labor_budget)
    const projProfit = profitOf(selectedProject)

    return (
      <div>
        <div className="topbar">
          <button aria-label="Back" onClick={() => setSelectedProject(null)} style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer', padding: '0' }}>←</button>
          <h1 style={{ fontSize: '16px' }}>{selectedProject.name}</h1>
          <span className={'status-pill status-' + selectedProject.stage} aria-label={`Job status: ${stageLabel(selectedProject.stage)}`}>{stageLabel(selectedProject.stage)}</span>
        </div>
        {matPct >= 80 && <div className={matPct >= 100 ? 'alert-danger' : 'alert-warning'} style={{ margin: '12px 16px 0' }}>{matPct >= 100 ? '🔴 Materials over budget!' : '⚠️ Materials at ' + Math.round(matPct) + '%'}</div>}
        {labPct >= 80 && <div className={labPct >= 100 ? 'alert-danger' : 'alert-warning'} style={{ margin: '8px 16px 0' }}>{labPct >= 100 ? '🔴 Labor over budget!' : '⚠️ Labor at ' + Math.round(labPct) + '%'}</div>}
        {/* The pill in the header now only REPORTS the stage; the control that
            changes it says out loud what it will do. It used to be a "Not
            started ↻" pill in the corner — plus a second, identical stage button
            buried at the bottom of the Budget tab. One job, one control. */}
        <div style={{ display: 'flex', gap: '8px', margin: '12px 16px 0' }}>
          <button className="btn-primary" style={{ flex: 2, marginTop: 0 }} onClick={() => cycleStage(selectedProject)}>
            {STAGE_ACTION[selectedProject.stage] || STAGE_ACTION.start}
          </button>
          <button className="btn-secondary" style={{ flex: 1, marginTop: 0 }} onClick={openEditJob}>✎ Edit</button>
        </div>
        <div className="tabs" style={{ margin: '12px 16px 0' }}>
          {PROJECT_TABS.map(t => (
            <button key={t.key} className={'tab ' + (projectTab === t.key ? 'active' : '')} onClick={() => setProjectTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <div className="page">
          {detailLoading ? (
            <div className="empty-state"><p>Loading…</p></div>
          ) : (
          <>
          {projectTab === 'money' && (
            <div>
              <JobSection title="Budget & profit" open={isOpen('budget')} onToggle={() => toggleSection('budget')}>
              {/* Profit hero — the one number that matters, surfaced at the top
                  instead of buried as the last of six cards. If no budget was
                  set yet, don't show a scary $0/over-budget — prompt to add one. */}
              {contractOf(selectedProject) > 0 ? (
                <div className="card" style={{ background: projProfit >= 0 ? '#F0FDF4' : '#FEF2F2', border: '1px solid ' + (projProfit >= 0 ? '#BBF7D0' : '#FECACA') }}>
                  <p style={{ fontSize: '12px', color: '#4B5563', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>Projected Profit</p>
                  <p style={{ fontSize: '32px', fontWeight: 800, lineHeight: 1.1, color: projProfit >= 0 ? '#15803D' : '#DC2626' }}>{formatCurrency(projProfit)}</p>
                  <p style={{ fontSize: '13px', color: '#4B5563', marginTop: '4px' }}>
                    {(() => {
                      // Guard against absurd margins on tiny contracts (e.g. a $50
                      // job losing $190 → -380%). Below -100% the loss exceeds the
                      // whole contract, so say "over budget" instead of a wild number.
                      const margin = Math.round((projProfit / contractOf(selectedProject)) * 100)
                      return margin >= -100 ? margin + '% margin · ' : 'over budget · '
                    })()}target {formatCurrency(selectedProject.profit_target)}
                  </p>
                  {projProfit < 0 && <p style={{ fontSize: '12px', color: '#DC2626', marginTop: '4px', fontWeight: 600 }}>⚠️ Projected to go over budget</p>}
                </div>
              ) : (
                <div className="card" role="button" tabIndex={0} onClick={openEditJob} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditJob() } }} style={{ cursor: 'pointer', background: '#FFF7ED', border: '1px solid #FED7AA' }}>
                  <p style={{ fontSize: '12px', color: '#9A3412', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>Set your budget to track profit</p>
                  <p style={{ fontSize: '15px', color: '#4B5563', lineHeight: 1.4 }}>Add materials, labor, and profit target for this job — then JobTally shows your live profit as costs come in. <span style={{ color: '#E07B2A', fontWeight: 700 }}>Add budget →</span></p>
                </div>
              )}
              <button className="btn-primary" onClick={() => { setInvoiceForm({ project_id: selectedProject.id, label: '', amount: '', issued_date: '', due_date: '', notes: '', payment_link: '' }); setActiveTab('invoices'); setSelectedProject(null); setShowNewInvoice(true); setInlineError('') }} style={{ background: '#16A34A', marginBottom: '12px' }}>+ Invoice this job</button>
              {(selectedProject.client_name || selectedProject.client_phone || selectedProject.client_email || selectedProject.client_address) && (
                <div className="card">
                  <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>CLIENT</p>
                  {selectedProject.client_name && <p style={{ fontWeight: '700', fontSize: '16px', color: '#1C2B3A' }}>{selectedProject.client_name}</p>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                    {selectedProject.client_phone && <a href={`tel:${selectedProject.client_phone}`} style={{ flex: '1 1 0', minWidth: '88px', textAlign: 'center', background: '#16A34A', color: 'white', textDecoration: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '600' }}>📞 Call</a>}
                    {selectedProject.client_phone && <a href={`sms:${selectedProject.client_phone}`} style={{ flex: '1 1 0', minWidth: '88px', textAlign: 'center', background: '#1C2B3A', color: 'white', textDecoration: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '600' }}>💬 Text</a>}
                    {selectedProject.client_email && <a href={`mailto:${selectedProject.client_email}`} style={{ flex: '1 1 0', minWidth: '88px', textAlign: 'center', background: '#E07B2A', color: 'white', textDecoration: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '600' }}>✉️ Email</a>}
                    {selectedProject.client_address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedProject.client_address)}`} target="_blank" rel="noopener noreferrer" style={{ flex: '1 1 0', minWidth: '88px', textAlign: 'center', background: '#4B5563', color: 'white', textDecoration: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '600' }}>📍 Map</a>}
                  </div>
                  {selectedProject.client_address && <p style={{ fontSize: '12px', color: '#717171', marginTop: '8px' }}>{selectedProject.client_address}</p>}
                </div>
              )}
              {coOf(selectedProject.id) > 0 && (
                <div className="card">
                  <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>CONTRACT + EXTRAS</p>
                  <p style={{ fontSize: '13px', color: '#4B5563' }}>Base contract <span style={{ float: 'right', fontWeight: '600' }}>{formatCurrency(selectedProject.budget)}</span></p>
                  <p style={{ fontSize: '13px', color: '#16A34A', marginTop: '4px' }}>Approved extras <span style={{ float: 'right', fontWeight: '600' }}>+{formatCurrency(coOf(selectedProject.id))}</span></p>
                  <p style={{ fontSize: '15px', fontWeight: '700', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #f0f0f0' }}>Adjusted contract <span style={{ float: 'right' }}>{formatCurrency(contractOf(selectedProject))}</span></p>
                </div>
              )}
              <div className="card">
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>MATERIALS</p>
                <p style={{ fontWeight: '700', fontSize: '18px' }}>{formatCurrency(sp.materials)} <span style={{ color: '#888', fontSize: '13px', fontWeight: '400' }}>of {formatCurrency(selectedProject.materials_budget)}</span></p>
                <div className="budget-bar"><div className={'budget-bar-fill ' + getBudgetClass(matPct)} style={{ width: matPct + '%' }} /></div>
              </div>
              <div className="card">
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>LABOR</p>
                <p style={{ fontWeight: '700', fontSize: '18px' }}>{formatCurrency(sp.labor)} <span style={{ color: '#888', fontSize: '13px', fontWeight: '400' }}>of {formatCurrency(selectedProject.labor_budget)}</span></p>
                <div className="budget-bar"><div className={'budget-bar-fill ' + getBudgetClass(labPct)} style={{ width: labPct + '%' }} /></div>
                {timeEntries.length > 0 && (
    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
      <p style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>By Worker</p>
      {Object.values(
        timeEntries.filter(t => t.clocked_out_at).reduce((acc, t) => {
          const name = t.profiles?.full_name || 'Unknown'
          if (!acc[name]) acc[name] = { name, minutes: 0, cost: 0 }
          acc[name].minutes += t.total_minutes || 0
          acc[name].cost += t.labor_cost || 0
          return acc
        }, {})
      ).map(w => (
        <div key={w.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f9f9f9' }}>
          <div>
            <p style={{ fontWeight: '600', fontSize: '14px' }}>{w.name}</p>
            <p style={{ fontSize: '12px', color: '#888' }}>{formatTime(w.minutes)}</p>
          </div>
          <p style={{ fontWeight: '700', color: '#1C2B3A', fontSize: '14px' }}>{formatCurrency(w.cost)}</p>
        </div>
      ))}
    </div>
  )}
              </div>
              {sp.other > 0 && (
                <div className="card">
                  <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>OTHER COSTS</p>
                  <p style={{ fontWeight: '700', fontSize: '18px', color: '#DC2626' }}>{formatCurrency(sp.other)}</p>
                  <p style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Non-materials receipts (gas, permits, tools, subs)</p>
                </div>
              )}
              {/* The two cards that used to sit here (PROFIT TARGET and a second
                  PROJECTED PROFIT) said the same thing as the hero at the top of
                  this section, and the stage/edit buttons under them duplicated
                  the ones now in the job header. Deleted, not moved. */}
              </JobSection>
              {/* Extras were a separate tab two rows away from the budget they
                  change — but an approved extra IS budget: it raises the adjusted
                  contract in the card above. Same tab, right underneath. */}
              <JobSection title="Extras & add-ons" count={changeOrders.length} open={isOpen('extras')} onToggle={() => toggleSection('extras')}>
                <button className="btn-primary" onClick={() => { setShowNewChange(true); setInlineError('') }} style={{ marginTop: 0 }}>+ Add extra / add-on</button>
                {changeOrders.some(c => c.status === 'approved') && (
                  <div className="card" style={{ background: '#1C2B3A', color: 'white' }}>
                    <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Approved extras</p>
                    <p style={{ fontSize: '24px', fontWeight: '800', color: '#16A34A' }}>+{formatCurrency(changeOrders.filter(c => c.status === 'approved').reduce((s, c) => s + (c.amount || 0), 0))}</p>
                    <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>added to what the client owes</p>
                  </div>
                )}
                {changeOrders.map(c => (
                  <div key={c.id} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, paddingRight: '10px' }}>
                        <h3>{c.description}</h3>
                        <span className={'status-pill ' + (c.status === 'approved' ? 'status-end' : c.status === 'declined' ? 'status-start' : 'status-mid')} style={{ marginTop: '4px' }}>{c.status}</span>
                      </div>
                      <p style={{ fontWeight: '700', color: c.status === 'approved' ? '#16A34A' : '#888', fontSize: '16px' }}>{formatCurrency(c.amount)}</p>
                    </div>
                    <button onClick={() => deleteChangeOrder(c)} style={{ marginTop: '10px', background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '8px 14px', borderRadius: '8px', minHeight: '40px' }}>Delete</button>
                  </div>
                ))}
                {changeOrders.length === 0 && <div className="empty-state"><p>No extras yet. Log extra work the client approves so you get paid for it.</p></div>}
              </JobSection>
            </div>
          )}

          {projectTab === 'work' && (
            <div>
              <JobSection title="Time" count={timeEntries.length} open={isOpen('time')} onToggle={() => toggleSection('time')}>
              <button className="btn-primary" style={{ marginTop: 0 }} onClick={() => { setShowNewTime(true); setInlineError(''); resetInvite(); setTimeForm({ worker_id: '', work_date: todayLocal(), start_time: '', end_time: '' }) }}>+ Add time</button>
              {timeEntries.map(t => (
                <div key={t.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <h3>{t.profiles ? t.profiles.full_name : 'Worker'}</h3>
                      <p>{new Date(t.clocked_in_at).toLocaleDateString()}</p>
                      <p>{t.total_minutes ? formatTime(t.total_minutes) : 'Still clocked in'}</p>
                      {/* Both ends of the shift, each its own map pin. Either
                          can be missing (location blocked / no fix), so they
                          render independently — never assume a start pin
                          means there's an end pin. */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '4px' }}>
                        {t.gps_lat != null && t.gps_lng != null && (
                          <a
                            href={`https://www.google.com/maps?q=${t.gps_lat},${t.gps_lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: '12px', color: '#E07B2A', textDecoration: 'none', display: 'inline-block' }}
                          >
                            📍 Clock-in location
                          </a>
                        )}
                        {t.gps_out_lat != null && t.gps_out_lng != null && (
                          <a
                            href={`https://www.google.com/maps?q=${t.gps_out_lat},${t.gps_out_lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: '12px', color: '#E07B2A', textDecoration: 'none', display: 'inline-block' }}
                          >
                            🏁 Clock-out location
                          </a>
                        )}
                      </div>
                    </div>
                    <p style={{ fontWeight: '700', color: '#1C2B3A' }}>{t.labor_cost ? formatCurrency(t.labor_cost) : '—'}</p>
                  </div>
                  <button
                    onClick={() => deleteTimeEntry(t)}
                    style={{
                      marginTop: '10px', background: 'none', border: '1px solid #FCA5A5', color: '#DC2626',
                      fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '8px 14px',
                      borderRadius: '8px', minHeight: '40px'
                    }}
                  >
                    Delete entry
                  </button>
                </div>
              ))}
              {timeEntries.length === 0 && <div className="empty-state"><p>No hours logged yet. Crew hours show up here when they clock in — or tap below to add time yourself.</p></div>}
              </JobSection>

              {/* Photos and the daily log used to be two separate tabs. On site
                  they're one act — "here's what happened today" — so they're one
                  feed now, grouped by day, newest first. Add a photo, add a
                  note, or both; they land on the same day card. */}
              <JobSection title="Daily notes" count={dailyLogs.length + jobPhotos.length} open={isOpen('daily')} onToggle={() => toggleSection('daily')}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <label className="btn-primary" style={{ flex: 1, marginTop: 0, textAlign: 'center', cursor: 'pointer' }}>
                    {uploadingPhoto ? 'Uploading…' : '📷 Add photo'}
                    {/* No `capture` attr → mobile offers BOTH Take Photo and Photo Library (gallery), not camera-only. */}
                    <input type="file" accept="image/*" onChange={addJobPhoto} disabled={uploadingPhoto} style={{ display: 'none' }} />
                  </label>
                  <button className="btn-secondary" style={{ flex: 1, marginTop: 0 }} onClick={() => { setShowNewLog(true); setInlineError('') }}>📝 Add note</button>
                </div>
                <input
                  type="text"
                  value={photoNote}
                  onChange={(e) => setPhotoNote(e.target.value)}
                  placeholder="Optional caption for the next photo you add"
                  maxLength={140}
                  style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0 0', padding: '10px 12px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px' }}
                />
                {buildDayFeed(dailyLogs, jobPhotos).map(day => (
                  <div key={day.key} className="card">
                    {/* 'T00:00:00' forces LOCAL midnight — a bare 'YYYY-MM-DD'
                        parses as UTC and shows a day early west of London. */}
                    <p className="schedule-day">{new Date(day.key + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                    {day.logs.map(l => (
                      <div key={l.id} style={{ marginTop: '8px' }}>
                        {l.weather && <p style={{ fontSize: '12px', color: '#E07B2A' }}>{l.weather}</p>}
                        <p style={{ marginTop: '2px', whiteSpace: 'pre-wrap' }}>{l.note}</p>
                        <button onClick={() => deleteLog(l)} style={{ marginTop: '8px', background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px' }}>Delete note</button>
                      </div>
                    ))}
                    {day.photos.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '10px' }}>
                        {day.photos.map(ph => (
                          <div key={ph.id} onClick={() => setPhotoLightbox(ph)} style={{ cursor: 'pointer' }}>
                            <JobPhoto path={ph.photo_url} signedUrl={photoUrls[ph.photo_url]} alt={ph.caption}
                              style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: '10px' }} />
                            {ph.uploaded_by_name && ph.uploaded_by_name !== 'You' && (
                              <p style={{ fontSize: '10px', color: '#717171', margin: '3px 2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>👷 {ph.uploaded_by_name}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {dailyLogs.length === 0 && jobPhotos.length === 0 && <div className="empty-state"><p>Nothing logged yet. Snap before/after shots and jot down what happened on site — great for clients, and it settles arguments later.</p></div>}
              </JobSection>

              <JobSection title="Receipts" count={receipts.length} open={isOpen('receipts')} onToggle={() => toggleSection('receipts')}>
                <button className="btn-primary" style={{ marginTop: 0 }} onClick={() => { setShowNewReceipt(true); setInlineError('') }}>+ Add receipt</button>
                {receipts.map(r => (
                  <div key={r.id} className="card" role="button" tabIndex={0} onClick={() => setPhotoViewer(r)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPhotoViewer(r) } }} style={{ cursor: r.photo_url ? 'pointer' : 'default' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <h3>{r.description}</h3>
                        <p>{r.store} · {CATEGORY_LABELS[r.category] || r.category}{r.tax_amount > 0 ? ` · tax ${formatCurrency(r.tax_amount)}` : ''}</p>
                        {/* Show the date ON the receipt when we have it. '+T00:00:00'
                            forces LOCAL midnight — a bare 'YYYY-MM-DD' parses as UTC
                            and would display a day early everywhere west of London. */}
                        <p style={{ fontSize: '11px', color: '#717171' }}>{r.purchase_date ? new Date(r.purchase_date + 'T00:00:00').toLocaleDateString() : new Date(r.created_at).toLocaleDateString()}</p>
                        {r.photo_url && <p style={{ fontSize: '11px', color: '#E07B2A', marginTop: '2px' }}>📷 Tap to view photo</p>}
                      </div>
                      <p style={{ fontWeight: '700', color: '#1C2B3A', fontSize: '16px' }}>{formatCurrency(r.amount)}</p>
                    </div>
                  </div>
                ))}
                {receipts.length === 0 && <div className="empty-state"><p>No receipts yet. Snap a receipt photo — JobTally reads the store, total, sales tax and date for you and adds it to this job's costs.</p></div>}
              </JobSection>

              <JobSection title="Mileage" count={mileageEntries.length} open={isOpen('mileage')} onToggle={() => toggleSection('mileage')}>
              <button className="btn-primary" style={{ marginTop: 0 }} onClick={() => { setShowNewMileage(true); setInlineError('') }}>+ Add mileage</button>
              {mileageEntries.length > 0 && (
                <div className="card" style={{ background: '#1C2B3A', color: 'white' }}>
                  <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Mileage Deduction</p>
                  <p style={{ fontSize: '24px', fontWeight: '800', color: '#16A34A' }}>
                    {formatCurrency(mileageEntries.reduce((s, m) => s + (m.miles || 0) * (m.rate || 0), 0))}
                  </p>
                  <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>{mileageEntries.reduce((s, m) => s + (m.miles || 0), 0).toLocaleString()} miles tracked</p>
                </div>
              )}
              {mileageEntries.map(m => (
                <div key={m.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3>{(m.miles || 0).toLocaleString()} mi <span style={{ fontWeight: '400', color: '#888', fontSize: '13px' }}>@ {formatCurrency(m.rate)}/mi</span></h3>
                      <p style={{ fontSize: '12px', color: '#717171' }}>{m.trip_date ? new Date(m.trip_date + 'T00:00:00').toLocaleDateString() : ''}{m.notes ? ` · ${m.notes}` : ''}</p>
                    </div>
                    <p style={{ fontWeight: '700', color: '#16A34A', fontSize: '16px' }}>{formatCurrency((m.miles || 0) * (m.rate || 0))}</p>
                  </div>
                  <button onClick={() => deleteMileage(m)} style={{ marginTop: '10px', background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '8px 14px', borderRadius: '8px', minHeight: '40px' }}>Delete</button>
                </div>
              ))}
              {mileageEntries.length === 0 && <div className="empty-state"><p>No mileage logged yet. Track miles driven for this job — it's a deduction.</p></div>}
              </JobSection>
            </div>
          )}

          {projectTab === 'docs' && (
            <div>
              <JobSection title="Documents" count={jobDocuments.length} open={isOpen('documents')} onToggle={() => toggleSection('documents')}>
              <label className="btn-primary" style={{ display: 'block', marginTop: 0, textAlign: 'center', cursor: 'pointer' }}>
                {uploadingDoc ? 'Uploading…' : '📎 Add document'}
                <input type="file" onChange={addDocument} disabled={uploadingDoc} style={{ display: 'none' }} />
              </label>
              {jobDocuments.map(doc => (
                <div key={doc.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ flex: 1, cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => openDocument(doc)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDocument(doc) } }}>
                    <h3 style={{ color: '#E07B2A' }}>📄 {doc.name}</h3>
                    <p style={{ fontSize: '11px', color: '#717171' }}>{doc.created_at ? new Date(doc.created_at).toLocaleDateString() : ''} · tap to open</p>
                  </div>
                  <button aria-label="Delete document" onClick={() => deleteDocument(doc)} style={{ background: 'white', border: '1px solid #FCA5A5', color: '#DC2626', fontSize: 13, cursor: 'pointer', padding: '6px 12px', borderRadius: 8 }}>Delete</button>
                </div>
              ))}
              {jobDocuments.length === 0 && <div className="empty-state"><p>No documents yet. Add the contract, permit, or plans for this job.</p></div>}
              </JobSection>
              {/* A permit IS a document — it was a whole separate tab because the
                  old nav had room for twelve of them. Same page, one scroll down. */}
              <JobSection title="Permits & inspections" count={permits.length} open={isOpen('permits')} onToggle={() => toggleSection('permits')}>
              <button className="btn-primary" style={{ marginTop: 0 }} onClick={() => { setShowNewPermit(true); setInlineError('') }}>+ Add permit</button>
              {permits.map(p => {
                const sc = (p.status === 'passed' || p.status === 'approved') ? 'status-end' : p.status === 'failed' ? 'status-start' : 'status-mid'
                return (
                  <div key={p.id} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, paddingRight: '10px' }}>
                        <h3>{p.name}</h3>
                        <p>{p.permit_number ? `#${p.permit_number}` : ''}{p.inspection_on ? ` · inspection ${new Date(p.inspection_on + 'T00:00:00').toLocaleDateString()}` : ''}</p>
                        <span className={'status-pill ' + sc} role="button" tabIndex={0} aria-label={`Status: ${p.status}. Activate to advance.`} style={{ marginTop: '4px', cursor: 'pointer' }} onClick={() => cyclePermitStatus(p)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cyclePermitStatus(p) } }}>{p.status} ↻</span>
                      </div>
                      <button aria-label="Remove permit" onClick={() => deletePermit(p)} style={{ background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px', flexShrink: 0 }}>Delete</button>
                    </div>
                  </div>
                )
              })}
              {permits.length === 0 && <div className="empty-state"><p>Track permits and inspections for this job. Tap a status to advance it.</p></div>}
              </JobSection>
            </div>
          )}

          {/* Plan = everything that hasn't happened yet: who's coming, what to
              buy, what's left to fix. Three lists that used to be three tabs
              in two different rows of navigation. */}
          {projectTab === 'plan' && (
            <div>
              <JobSection title="Schedule" count={scheduleEntries.length} open={isOpen('schedule')} onToggle={() => toggleSection('schedule')}>
                <button className="btn-primary" style={{ marginTop: 0 }} onClick={() => { setShowNewSchedule(true); setInlineError('') }}>+ Schedule worker</button>
                {scheduleEntries.map(s => (
                  <div key={s.id} className="card">
                    <p className="schedule-day">{new Date(s.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                    <h3>{s.profiles ? s.profiles.full_name : 'Worker'}</h3>
                    <p>{s.task_description}</p>
                    {s.start_time && <p style={{ fontSize: '12px', color: '#E07B2A', marginTop: '4px', fontWeight: '600' }}>{s.start_time} — {s.end_time}</p>}
                  </div>
                ))}
                {scheduleEntries.length === 0 && <div className="empty-state"><p>Nothing scheduled yet. Add a crew member and a day to plan who's working this job. They see their own days on their phone.</p></div>}
              </JobSection>

              <JobSection title="Shopping list" count={materialItems.filter(it => !it.bought).length} open={isOpen('materials')} onToggle={() => toggleSection('materials')}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <input value={materialInput.name} onChange={e => setMaterialInput({ ...materialInput, name: e.target.value })} placeholder="Item (e.g. 2x4s)" style={{ flex: 2, minWidth: '0', padding: '12px', border: '1.5px solid #ddd', borderRadius: '8px', fontSize: '14px' }} />
                  <input value={materialInput.qty} onChange={e => setMaterialInput({ ...materialInput, qty: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') addMaterial() }} placeholder="Qty" style={{ width: '64px', padding: '12px', border: '1.5px solid #ddd', borderRadius: '8px', fontSize: '14px' }} />
                  <button onClick={addMaterial} className="btn-primary" style={{ width: 'auto', marginTop: 0, padding: '12px 18px' }}>Add</button>
                </div>
                {materialItems.map(it => (
                  <div key={it.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px' }}>
                    <input type="checkbox" checked={it.bought} onChange={() => toggleMaterial(it)} style={{ width: '20px', height: '20px', cursor: 'pointer', flexShrink: 0 }} />
                    <p style={{ flex: 1, fontSize: '14px', textDecoration: it.bought ? 'line-through' : 'none', color: it.bought ? '#9CA3AF' : '#1C2B3A' }}>{it.name}{it.qty ? <span style={{ color: '#888' }}> · {it.qty}</span> : ''}</p>
                    <button aria-label="Delete item" onClick={() => deleteMaterial(it)} style={{ background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px', flexShrink: 0 }}>Delete</button>
                  </div>
                ))}
                {materialItems.length === 0 && <div className="empty-state"><p>Build your shopping list — check items off as you buy them. The crew on this job sees it too.</p></div>}
              </JobSection>

              <JobSection title="Fix-it list" count={punchItems.filter(it => !it.done).length} open={isOpen('punch')} onToggle={() => toggleSection('punch')}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <input value={punchInput} onChange={e => setPunchInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPunch() }} placeholder="Add a to-do (e.g. Caulk tub)" style={{ flex: 1, padding: '12px', border: '1.5px solid #ddd', borderRadius: '8px', fontSize: '14px' }} />
                  <button onClick={addPunch} className="btn-primary" style={{ width: 'auto', marginTop: 0, padding: '12px 18px' }}>Add</button>
                </div>
                {punchItems.map(it => (
                  <div key={it.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px' }}>
                    <input type="checkbox" checked={it.done} onChange={() => togglePunch(it)} style={{ width: '20px', height: '20px', cursor: 'pointer', flexShrink: 0 }} />
                    <p style={{ flex: 1, fontSize: '14px', textDecoration: it.done ? 'line-through' : 'none', color: it.done ? '#9CA3AF' : '#1C2B3A' }}>{it.description}</p>
                    <button aria-label="Delete item" onClick={() => deletePunch(it)} style={{ background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px', flexShrink: 0 }}>Delete</button>
                  </div>
                ))}
                {punchItems.length === 0 && <div className="empty-state"><p>Nothing left to fix. Add any touch-ups before you call the job done — the crew sees these too.</p></div>}
              </JobSection>
            </div>
          )}
          </>
          )}
        </div>

        {showNewReceipt && (
          <div className="modal-overlay" onClick={() => { setShowNewReceipt(false); setScanResult(null); setScanError('') }}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Add Receipt</h2>
              <div className="input-group">
                <label>📷 Scan Receipt Photo</label>
                <input type="file" accept="image/*" capture="environment" onChange={scanReceipt} style={{ padding: '8px 0' }} />
                {scanning && <p style={{ color: '#E07B2A', fontSize: '13px', marginTop: '6px' }}>🔍 Scanning receipt…</p>}
                {scanError && <p style={{ color: '#DC2626', fontSize: '13px', marginTop: '6px' }}>{scanError}</p>}
              </div>
              {scanResult && (
                <div style={{ background: '#f0fdf4', border: '1px solid #16A34A', borderRadius: '10px', padding: '14px', marginBottom: '14px' }}>
                  <p style={{ fontSize: '12px', color: '#16A34A', fontWeight: '600', marginBottom: '8px' }}>📷 Scanned — confirm before saving</p>
                  <p style={{ fontSize: '15px', fontWeight: '600' }}>Store: {scanResult.store}</p>
                  {/* Subtotal + tax + total, in the order they're printed on the
                      paper, so the owner can check the scan against the receipt
                      in their hand. Only the first two get saved. */}
                  <p style={{ fontSize: '15px', fontWeight: '600' }}>Subtotal: {formatCurrency(scanResult.amount)}</p>
                  {scanResult.tax && !/^none$/i.test(String(scanResult.tax)) && (
                    <p style={{ fontSize: '15px', fontWeight: '600' }}>Sales tax: {formatCurrency(scanResult.tax)}</p>
                  )}
                  {scanResult.total && (
                    <p style={{ fontSize: '15px', fontWeight: '700', color: '#166534' }}>Total: {formatCurrency(scanResult.total)}</p>
                  )}
                  {scanResult.date && /^\d{4}-\d{2}-\d{2}$/.test(scanResult.date) && (
                    <p style={{ fontSize: '15px', fontWeight: '600' }}>Date: {scanResult.date}</p>
                  )}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <button onClick={confirmScan} style={{ flex: 1, background: '#16A34A', color: 'white', border: 'none', borderRadius: '8px', padding: '10px', fontWeight: '600', cursor: 'pointer' }}>Looks right ✓</button>
                    <button onClick={() => setScanResult(null)} style={{ flex: 1, background: 'transparent', color: '#16A34A', border: '2px solid #16A34A', borderRadius: '8px', padding: '10px', fontWeight: '600', cursor: 'pointer' }}>Edit manually</button>
                  </div>
                </div>
              )}
              <div className="input-group"><label>Description</label><input value={receiptForm.description} onChange={e => setReceiptForm({ ...receiptForm, description: e.target.value })} placeholder="Concrete mix" /></div>
              <div className="input-group"><label>Store</label><input value={receiptForm.store} onChange={e => setReceiptForm({ ...receiptForm, store: e.target.value })} placeholder="Home Depot" /></div>
              {/* Labelled "before tax" because the tax goes in its own field
                  below and the job's cost is the two added together. An owner
                  who types the grand total here AND the tax pays the tax twice. */}
              <div className="input-group"><label>Amount ($) <span style={{ color: '#888', fontWeight: '400' }}>— before tax</span></label><input type="number" value={receiptForm.amount} onChange={e => setReceiptForm({ ...receiptForm, amount: e.target.value })} placeholder="0.00" /></div>
              <div className="input-group"><label>Sales Tax ($) <span style={{ color: '#888', fontWeight: '400' }}>— optional</span></label><input type="number" value={receiptForm.tax} onChange={e => setReceiptForm({ ...receiptForm, tax: e.target.value })} placeholder="0.00" /></div>
              <div className="input-group"><label>Date on the receipt <span style={{ color: '#888', fontWeight: '400' }}>— leave blank for today</span></label><input type="date" value={receiptForm.purchase_date} onChange={e => setReceiptForm({ ...receiptForm, purchase_date: e.target.value })} /></div>
              <div className="input-group"><label>Category</label><select value={receiptForm.category} onChange={e => setReceiptForm({ ...receiptForm, category: e.target.value })}>{RECEIPT_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></div>
              {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
              <button className="btn-primary" onClick={addReceipt} disabled={loading || !receiptForm.amount}>{loading ? 'Saving…' : 'Save receipt'}</button>
              <button className="btn-secondary" onClick={() => { setShowNewReceipt(false); setScanResult(null); setScanError(''); setInlineError('') }}>Cancel</button>
            </div>
          </div>
        )}

        {scheduleModal}

        {showNewMileage && (
          <div className="modal-overlay" onClick={() => { setShowNewMileage(false); setInlineError('') }}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Add Mileage</h2>
              <div className="input-group"><label>Miles driven</label><input type="number" value={mileageForm.miles} onChange={e => setMileageForm({ ...mileageForm, miles: e.target.value })} placeholder="42" /></div>
              <div className="input-group"><label>Rate ($/mile)</label><input type="number" step="0.01" value={mileageForm.rate} onChange={e => setMileageForm({ ...mileageForm, rate: e.target.value })} placeholder="0.70" /></div>
              <div className="input-group"><label>Date</label><input type="date" value={mileageForm.trip_date} onChange={e => setMileageForm({ ...mileageForm, trip_date: e.target.value })} /></div>
              <div className="input-group"><label>Notes (optional)</label><input value={mileageForm.notes} onChange={e => setMileageForm({ ...mileageForm, notes: e.target.value })} placeholder="Supply run to Home Depot" /></div>
              <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>Deduction = {formatCurrency((parseFloat(mileageForm.miles) || 0) * (parseFloat(mileageForm.rate) || 0))} · set the rate to the current IRS standard mileage rate.</p>
              {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
              <button className="btn-primary" onClick={addMileage} disabled={loading}>{loading ? 'Saving…' : 'Add mileage'}</button>
              <button className="btn-secondary" onClick={() => { setShowNewMileage(false); setInlineError('') }}>Cancel</button>
            </div>
          </div>
        )}

        {showNewTime && (
          <div className="modal-overlay" onClick={() => { setShowNewTime(false); setInlineError(''); resetInvite() }}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Add Time</h2>
              <div className="input-group">
                <label>Worker</label>
                <select value={timeForm.worker_id} onChange={e => setTimeForm({ ...timeForm, worker_id: e.target.value })}><option value="">Select worker</option>{workers.map(w => <option key={w.id} value={w.id}>{w.full_name}{w.hourly_rate ? ` — ${formatCurrency(w.hourly_rate)}/hr` : ''}</option>)}</select>
                {!showInvite && (
                  <button type="button" onClick={() => { setShowInvite(true); setInviteName(''); setInviteLink(''); setInviteCopied(false); setInlineError('') }} style={{ marginTop: '6px', background: 'none', border: 'none', color: '#E07B2A', fontSize: '13px', fontWeight: '700', cursor: 'pointer', padding: '4px 0' }}>
                    {workers.length === 0 ? '+ Invite a worker to send them a link' : 'Don’t see them? + Invite a new worker'}
                  </button>
                )}
              </div>
              {showInvite && (
                <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '10px', padding: '12px', marginBottom: '12px' }}>
                  {!inviteLink ? (
                    <>
                      <div className="input-group" style={{ marginBottom: '8px' }}>
                        <label htmlFor="time-invite-name">New worker’s name</label>
                        <input id="time-invite-name" type="text" value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Mike Reyes" />
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" onClick={createInvite} disabled={loading} className="btn-primary" style={{ flex: 1 }}>{loading ? 'Creating…' : 'Create invite link'}</button>
                        <button type="button" onClick={() => { setShowInvite(false); setInviteName(''); setInlineError('') }} style={{ background: 'transparent', color: '#888', border: '1px solid #ddd', borderRadius: '8px', padding: '0 16px', cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 style={{ marginBottom: '4px', fontSize: '15px' }}>Link ready for {inviteName} 🎉</h3>
                      <p style={{ fontSize: '13px', color: '#888', marginBottom: '10px' }}>Text it to {inviteName}. One tap and he’s on your crew — no password, nothing to download. If you’ve only got one job running he lands right on the clock; otherwise tap <b>Assign</b> on his card first.</p>
                      <div style={{ background: 'white', border: '1px solid #eee', borderRadius: '8px', padding: '10px', fontSize: '12px', color: '#1C2B3A', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: '10px' }}>{inviteMessage(inviteName, inviteLink)}</div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" onClick={() => copyInvite()} className="btn-primary" style={{ flex: 1 }}>{inviteCopied ? 'Sent ✓' : 'Text it over'}</button>
                        <button type="button" onClick={() => { setShowInvite(false); setInviteName(''); setInviteLink(''); setInviteCopied(false) }} style={{ background: 'transparent', color: '#888', border: '1px solid #ddd', borderRadius: '8px', padding: '0 16px', cursor: 'pointer' }}>Done</button>
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="input-group"><label>Date</label><input type="date" value={timeForm.work_date} onChange={e => setTimeForm({ ...timeForm, work_date: e.target.value })} /></div>
              <div className="input-group"><label>Start time</label><input type="time" value={timeForm.start_time} onChange={e => setTimeForm({ ...timeForm, start_time: e.target.value })} /></div>
              <div className="input-group"><label>End time</label><input type="time" value={timeForm.end_time} onChange={e => setTimeForm({ ...timeForm, end_time: e.target.value })} /></div>
              {(() => {
                if (!timeForm.work_date || !timeForm.start_time || !timeForm.end_time) return null
                const s = new Date(`${timeForm.work_date}T${timeForm.start_time}`)
                const en = new Date(`${timeForm.work_date}T${timeForm.end_time}`)
                if (isNaN(s.getTime()) || isNaN(en.getTime()) || en <= s) return null
                const mins = Math.floor((en - s) / 60000)
                const w = workers.find(x => x.id === timeForm.worker_id)
                const cost = (mins / 60) * (w?.hourly_rate || 0)
                return <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>{formatTime(mins)} · {formatCurrency(cost)}{(w && !w.hourly_rate) ? ' — set this worker’s hourly rate (Workers tab) to track labor cost' : ''}</p>
              })()}
              {workers.length === 0 && !showInvite && <p style={{ fontSize: '12px', color: '#DC2626', marginBottom: '8px' }}>No workers yet — tap “Invite a worker” above to send someone a sign-up link. Once they join, you can log their time here.</p>}
              {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
              <button className="btn-primary" onClick={addTimeEntry} disabled={loading || workers.length === 0}>{loading ? 'Saving…' : 'Add time'}</button>
              <button className="btn-secondary" onClick={() => { setShowNewTime(false); setInlineError(''); resetInvite() }}>Cancel</button>
            </div>
          </div>
        )}

        {showEditJob && (
          <div className="modal-overlay" onClick={() => { setShowEditJob(false); setInlineError('') }}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Edit Job</h2>
              <div className="input-group"><label>Job Name</label><input value={editJobForm.name} onChange={e => setEditJobForm({ ...editJobForm, name: e.target.value })} placeholder="Kitchen remodel" /></div>
              <div className="input-group"><label>Client</label><input value={editJobForm.client_name} onChange={e => setEditJobForm({ ...editJobForm, client_name: e.target.value })} placeholder="Client name" /></div>
              <div className="input-group"><label>Client Phone</label><input type="tel" value={editJobForm.client_phone} onChange={e => setEditJobForm({ ...editJobForm, client_phone: e.target.value })} placeholder="(518) 555-0199" /></div>
              <div className="input-group"><label>Client Email</label><input type="email" value={editJobForm.client_email} onChange={e => setEditJobForm({ ...editJobForm, client_email: e.target.value })} placeholder="john@email.com" /></div>
              <div className="input-group"><label>Job Address</label><input value={editJobForm.client_address} onChange={e => setEditJobForm({ ...editJobForm, client_address: e.target.value })} placeholder="24 Pinewood Dr, Troy NY" /></div>
              <div className="input-group"><label>Materials Budget ($)</label><input type="number" value={editJobForm.materials_budget} onChange={e => setEditJobForm({ ...editJobForm, materials_budget: e.target.value })} placeholder="0.00" /></div>
              <div className="input-group"><label>Labor Budget ($)</label><input type="number" value={editJobForm.labor_budget} onChange={e => setEditJobForm({ ...editJobForm, labor_budget: e.target.value })} placeholder="0.00" /></div>
              <div className="input-group"><label>Profit Target ($)</label><input type="number" value={editJobForm.profit_target} onChange={e => setEditJobForm({ ...editJobForm, profit_target: e.target.value })} placeholder="0.00" /></div>
              <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>Contract price = ${((parseFloat(editJobForm.materials_budget) || 0) + (parseFloat(editJobForm.labor_budget) || 0) + (parseFloat(editJobForm.profit_target) || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
              <button className="btn-primary" onClick={saveEditJob} disabled={loading}>{loading ? 'Saving…' : 'Save changes'}</button>
              <button className="btn-secondary" onClick={() => { setShowEditJob(false); setInlineError('') }}>Cancel</button>
            </div>
          </div>
        )}

        {showNewLog && (
          <div className="modal-overlay" onClick={() => { setShowNewLog(false); setInlineError('') }}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Add Log Entry</h2>
              <div className="input-group"><label>Date</label><input type="date" value={logForm.log_date} onChange={e => setLogForm({ ...logForm, log_date: e.target.value })} /></div>
              <div className="input-group"><label>Weather (optional)</label><input value={logForm.weather} onChange={e => setLogForm({ ...logForm, weather: e.target.value })} placeholder="Sunny, 70°" /></div>
              <div className="input-group"><label>What happened on site?</label><textarea rows={4} value={logForm.note} onChange={e => setLogForm({ ...logForm, note: e.target.value })} placeholder="Framed the addition. Inspector signed off. Waiting on cabinet delivery." /></div>
              {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
              <button className="btn-primary" onClick={addLog} disabled={loading}>{loading ? 'Saving…' : 'Save log'}</button>
              <button className="btn-secondary" onClick={() => { setShowNewLog(false); setInlineError('') }}>Cancel</button>
            </div>
          </div>
        )}

        {showNewPermit && (
          <div className="modal-overlay" onClick={() => { setShowNewPermit(false); setInlineError('') }}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Add Permit</h2>
              <div className="input-group"><label>Permit</label><input value={permitForm.name} onChange={e => setPermitForm({ ...permitForm, name: e.target.value })} placeholder="Electrical permit" /></div>
              <div className="input-group"><label>Status</label><select value={permitForm.status} onChange={e => setPermitForm({ ...permitForm, status: e.target.value })}><option value="applied">Applied</option><option value="approved">Approved</option><option value="inspection">Inspection scheduled</option><option value="passed">Passed</option><option value="failed">Failed</option></select></div>
              <div className="input-group"><label>Permit # (optional)</label><input value={permitForm.permit_number} onChange={e => setPermitForm({ ...permitForm, permit_number: e.target.value })} placeholder="B-2026-0481" /></div>
              <div className="input-group"><label>Inspection date (optional)</label><input type="date" value={permitForm.inspection_on} onChange={e => setPermitForm({ ...permitForm, inspection_on: e.target.value })} /></div>
              {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
              <button className="btn-primary" onClick={addPermit} disabled={loading}>{loading ? 'Saving…' : 'Add permit'}</button>
              <button className="btn-secondary" onClick={() => { setShowNewPermit(false); setInlineError('') }}>Cancel</button>
            </div>
          </div>
        )}

        {showNewChange && (
          <div className="modal-overlay" onClick={() => { setShowNewChange(false); setInlineError('') }}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Add extra / add-on</h2>
              <div className="input-group"><label>What's the change?</label><input value={changeForm.description} onChange={e => setChangeForm({ ...changeForm, description: e.target.value })} placeholder="Add tile backsplash" /></div>
              <div className="input-group"><label>Price ($)</label><input type="number" value={changeForm.amount} onChange={e => setChangeForm({ ...changeForm, amount: e.target.value })} placeholder="850" /></div>
              <div className="input-group"><label>Status</label><select value={changeForm.status} onChange={e => setChangeForm({ ...changeForm, status: e.target.value })}><option value="approved">Approved</option><option value="pending">Pending</option><option value="declined">Declined</option></select></div>
              <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>Approved extras add to what the client owes and to your projected profit.</p>
              {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
              <button className="btn-primary" onClick={addChangeOrder} disabled={loading}>{loading ? 'Saving…' : 'Add extra / add-on'}</button>
              <button className="btn-secondary" onClick={() => { setShowNewChange(false); setInlineError('') }}>Cancel</button>
            </div>
          </div>
        )}

        {photoLightbox && (
          <div className="modal-overlay" onClick={() => setPhotoLightbox(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '20px 20px 0 0', padding: '20px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: '700' }}>{photoLightbox.caption || 'Job photo'}</h2>
                <button aria-label="Close" onClick={() => setPhotoLightbox(null)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#888' }}>×</button>
              </div>
              <JobPhoto path={photoLightbox.photo_url} alt={photoLightbox.caption} style={{ width: '100%', borderRadius: '12px', objectFit: 'contain', maxHeight: '60vh', background: '#eef1f5' }} />
              <p style={{ fontSize: '12px', color: '#717171', marginTop: '10px' }}>{photoLightbox.uploaded_by_name && photoLightbox.uploaded_by_name !== 'You' ? '👷 ' + photoLightbox.uploaded_by_name + ' · ' : ''}{photoLightbox.created_at ? new Date(photoLightbox.created_at).toLocaleString() : ''}</p>
              <button onClick={() => deleteJobPhoto(photoLightbox)} style={{ marginTop: '16px', width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #DC2626', background: 'white', color: '#DC2626', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>Delete photo</button>
            </div>
          </div>
        )}

        {photoViewer && <PhotoViewer receipt={photoViewer} onClose={() => setPhotoViewer(null)} onDelete={deleteReceipt} />}
        {testimonialModal}
        <Toast message={toast} type={toastType} onClose={() => setToast('')} />
      </div>
    )
  }

  // MAIN DASHBOARD
  return (
    <div>
      <div className="topbar"><h1>JobTally</h1></div>
      <div className="page">

        {activeTab === 'money' && (
          <div>
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 4px' }}>Estimates, invoices, clients and the numbers.</p>
            <HubCard icon="📝" title="Estimates" sub="Quote jobs and win the work" onClick={() => setActiveTab('estimates')} />
            <HubCard icon="🧾" title="Invoices" sub="Bill clients and track what you're owed" onClick={() => setActiveTab('invoices')} />
            <HubCard icon="👥" title="Clients" sub="Everyone you've worked with" onClick={() => setActiveTab('clients')} />
            <HubCard icon="📊" title="Business health" sub="Who owes you, money collected, jobs won" onClick={() => setActiveTab('insights')} />
            <HubCard icon="📦" title="Reports & Taxes" sub="Year-end summaries and exports" onClick={() => setActiveTab('reports')} />
          </div>
        )}

        {activeTab === 'crew' && (
          <div>
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 4px' }}>Your workers, their week, and their pay.</p>
            <HubCard icon="📅" title="This week" sub="Who's working which day, and where" onClick={() => setActiveTab('crewweek')} />
            <HubCard icon="👷" title="Workers" sub="Add crew, set rates, time-off requests" onClick={() => setActiveTab('workers')} />
            <HubCard icon="💰" title="Crew Pay" sub="Weekly pay from clocked hours" onClick={() => setActiveTab('payroll')} />
          </div>
        )}

        {activeTab === 'crewweek' && (() => {
          const todayWeek = weekStartKey(new Date())
          const todayKey = dateKey(new Date())
          const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDaysKey(crewWeekStart, i))
          const endKey = days[6]
          const scheduledIds = new Set(crewWeek.map(s => s.worker_id))
          const unscheduled = workers.filter(w => !scheduledIds.has(w.id))
          // Approved time off only. A pending request isn't a promise, and
          // showing it as "out" would have the owner planning around a day the
          // worker is still expected to show up for.
          const offOn = (key) => timeOff.filter(r => r.status === 'approved' && r.start_date <= key && r.end_date >= key)
          const openAdd = (key) => {
            setScheduleForm({ worker_id: '', project_id: '', task_description: '', scheduled_date: key, start_time: '', end_time: '' })
            setInlineError('')
            setShowNewSchedule(true)
          }
          return (
            <div>
              <BackBtn label="Crew" onClick={() => setActiveTab('crew')} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
                <button aria-label="Previous week" onClick={() => setCrewWeekStart(addDaysKey(crewWeekStart, -7))} style={{ minHeight: '44px', minWidth: '44px', borderRadius: '10px', border: '1px solid #ddd', background: 'white', color: '#1C2B3A', fontSize: '18px', fontWeight: '700', cursor: 'pointer' }}>‹</button>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '15px', fontWeight: '700', color: '#1C2B3A' }}>{formatDateRange(crewWeekStart, endKey)}</p>
                  <p style={{ fontSize: '12px', color: '#888' }}>{crewWeekStart === todayWeek ? 'This week' : (crewWeekStart < todayWeek ? 'Past week' : 'Upcoming')}{crewWeekLoading ? ' · loading…' : ` · ${crewWeek.length} shift${crewWeek.length === 1 ? '' : 's'}`}</p>
                </div>
                <button aria-label="Next week" onClick={() => setCrewWeekStart(addDaysKey(crewWeekStart, 7))} style={{ minHeight: '44px', minWidth: '44px', borderRadius: '10px', border: '1px solid #ddd', background: 'white', color: '#1C2B3A', fontSize: '18px', fontWeight: '700', cursor: 'pointer' }}>›</button>
              </div>
              {crewWeekStart !== todayWeek && (
                <button onClick={() => setCrewWeekStart(todayWeek)} style={{ width: '100%', minHeight: '44px', borderRadius: '10px', border: '1px solid #ddd', background: 'white', color: '#1C2B3A', fontSize: '14px', fontWeight: '700', cursor: 'pointer', marginBottom: '12px' }}>Back to this week</button>
              )}

              {days.map(key => {
                const shifts = crewWeek.filter(s => s.scheduled_date === key)
                const out = offOn(key)
                const isToday = key === todayKey
                const d = new Date(key + 'T00:00:00')
                return (
                  <div key={key} className="card" style={{ padding: '12px 14px', marginBottom: '8px', border: isToday ? '2px solid #1C2B3A' : undefined }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                      <p style={{ fontWeight: '700', fontSize: '14px', color: '#1C2B3A' }}>
                        {d.toLocaleDateString('en-US', { weekday: 'long' })} <span style={{ color: '#888', fontWeight: '500' }}>{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        {isToday && <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 800, letterSpacing: '1px', color: '#1D4ED8', background: '#DBEAFE', borderRadius: '6px', padding: '2px 6px' }}>TODAY</span>}
                      </p>
                      <button onClick={() => openAdd(key)} style={{ background: 'none', border: 'none', color: '#1C2B3A', fontSize: '13px', fontWeight: '700', cursor: 'pointer', minHeight: '44px', padding: '0 2px' }}>+ Add</button>
                    </div>
                    {shifts.length === 0 && out.length === 0 && <p style={{ fontSize: '13px', color: '#aaa', marginTop: '2px' }}>Nobody scheduled</p>}
                    {shifts.map(s => (
                      <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', paddingTop: '8px', marginTop: '8px', borderTop: '1px solid #f0f0f0' }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontWeight: '600', fontSize: '14px' }}>{s.profiles ? s.profiles.full_name : 'Worker'}{s.start_time ? ` · ${(s.start_time || '').slice(0, 5)}${s.end_time ? '–' + (s.end_time || '').slice(0, 5) : ''}` : ' · time not set'}</p>
                          <p style={{ fontSize: '12px', color: '#888' }}>{s.projects ? s.projects.name : 'No job'}{s.task_description ? ' · ' + s.task_description : ''}</p>
                        </div>
                        <button aria-label="Remove shift" onClick={() => deleteSchedule(s)} style={{ background: 'none', border: 'none', color: '#DC2626', fontSize: '13px', fontWeight: '600', cursor: 'pointer', minHeight: '44px', flexShrink: 0 }}>Remove</button>
                      </div>
                    ))}
                    {out.map(r => {
                      const wk = workers.find(x => x.id === r.worker_id)
                      return <p key={r.id} style={{ fontSize: '13px', color: '#B45309', marginTop: '6px' }}>🌴 {wk ? wk.full_name : 'A worker'} is off{r.reason ? ` — ${r.reason}` : ''}</p>
                    })}
                  </div>
                )
              })}

              {/* Not a nag — it's the answer to "who am I forgetting to put to work." */}
              {unscheduled.length > 0 && (
                <div className="card" style={{ marginTop: '12px', background: '#FAFAFA' }}>
                  <p style={sectionLabel}>Not on the schedule this week</p>
                  <p style={{ fontSize: '13px', color: '#555' }}>{unscheduled.map(w => w.full_name).join(', ')}</p>
                </div>
              )}
              {workers.length === 0 && (
                <div className="empty-state"><p>No crew yet. Add workers first, then put them on the calendar.</p><button className="btn-primary" onClick={() => setActiveTab('workers')}>Add a worker</button></div>
              )}
            </div>
          )
        })()}

        {activeTab === 'more' && (
          <div>
            <BackBtn label="Home" onClick={() => setActiveTab('home')} />
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 4px' }}>More tools</p>
            <HubCard icon="🛡️" title="Insurance & Licenses" sub="Track expirations before they lapse" onClick={() => setActiveTab('compliance')} />
            <HubCard icon="🔧" title="Callbacks & warranty work" sub="Post-job follow-ups and fixes under warranty" onClick={() => setActiveTab('warranties')} />
            <HubCard icon="⚙️" title="Settings & Billing" sub="Your business info and subscription" onClick={() => { setSettingsForm({ company_name: profile.company_name || '', full_name: profile.full_name || '' }); setActiveTab('settings') }} />
          </div>
        )}

        {activeTab === 'settings' && (
          <div>
            <button onClick={() => setActiveTab('more')} style={{ background: 'none', border: 'none', color: '#E07B2A', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '8px', padding: '4px' }}>‹ More</button>
            <div className="card">
              <h3 style={{ marginBottom: '4px' }}>Your business</h3>
              <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px' }}>This shows up on your estimates and invoices.</p>
              <div className="input-group">
                <label htmlFor="set-company">Company name</label>
                <input id="set-company" type="text" value={settingsForm.company_name} onChange={e => setSettingsForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Reynolds Contracting" />
              </div>
              <div className="input-group">
                <label htmlFor="set-name">Your name</label>
                <input id="set-name" type="text" value={settingsForm.full_name} onChange={e => setSettingsForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Mike Reynolds" />
              </div>
              <div className="input-group">
                <label htmlFor="set-email">Email</label>
                <input id="set-email" type="email" value={profile.email || ''} disabled style={{ background: '#f4f4f5', color: '#888' }} />
                <p style={{ fontSize: '12px', color: '#888', margin: '4px 2px 0' }}>Contact support to change your login email.</p>
              </div>
              <button className="btn-primary" onClick={saveSettings} disabled={settingsSaving} style={{ width: '100%' }}>{settingsSaving ? 'Saving…' : 'Save changes'}</button>
            </div>
            <div className="card">
              <h3 style={{ marginBottom: '4px' }}>Subscription & billing</h3>
              <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px' }}>Manage your plan, payment method, and invoices.</p>
              <button className="btn-secondary" onClick={() => { window.location.assign('?billing') }} style={{ width: '100%' }}>Manage subscription & plan</button>
            </div>
            {/* Your data. An owner putting every receipt and every hour of his
                business into someone else's hands is entitled to a straight
                answer about where it goes — and to walk out with all of it.
                Written plainly on purpose: this is the part people actually
                read before they trust you. */}
            <div className="card">
              <h3 style={{ marginBottom: '4px' }}>Your data</h3>
              <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px' }}>Where it's kept, and how to take it with you.</p>
              <ul style={{ fontSize: '13px', color: '#4B5563', lineHeight: '1.55', margin: '0 0 14px', paddingLeft: '18px' }}>
                <li style={{ marginBottom: '6px' }}>Everything you enter — jobs, receipts, hours, photos, invoices — is stored on servers in the <b>United States</b>.</li>
                <li style={{ marginBottom: '6px' }}><b>No other company can see any of it.</b> The database checks who's asking on every single request, so one business can never read another's jobs, clients, crew or files.</li>
                <li style={{ marginBottom: '6px' }}>Receipt photos are read by Claude to pull out the store and the total, so you don't have to type them. That's the only thing the picture is used for.</li>
                <li style={{ marginBottom: '6px' }}>Card numbers are handled by <b>Stripe</b> and never touch JobTally.</li>
                <li style={{ marginBottom: '6px' }}><b>We don't sell your data, to anyone, ever.</b></li>
                <li>Cancelling doesn't erase anything — your records stay put.</li>
              </ul>
              <button className="btn-secondary" onClick={exportEverything} disabled={loading} style={{ width: '100%', margin: 0 }}>
                {loading ? 'Gathering…' : '⬇ Download everything I have'}
              </button>
              <p style={{ fontSize: '12px', color: '#888', margin: '8px 2px 0', lineHeight: '1.5' }}>
                One file, opens in Excel — every job, receipt, hour, invoice and estimate on your account. It's yours whether you stay or go.
              </p>
              <p style={{ fontSize: '12px', color: '#888', margin: '10px 2px 0' }}>
                Full details: <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: '#E07B2A', fontWeight: 600 }}>Privacy Policy</a>
              </p>
            </div>
            {/* Delete account. Deliberately its own card at the very bottom, and
                deliberately not styled like the buttons above it — the download
                is something you want people to find, this is something you want
                people to mean. Two steps: reveal, then type your own email.
                Nothing here is undoable, so the copy says so in the plainest
                words available rather than hiding behind "this action cannot be
                reversed." */}
            <div className="card" style={{ borderColor: '#f1d4d4' }}>
              <h3 style={{ marginBottom: '4px' }}>Delete my account</h3>
              <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', lineHeight: '1.55' }}>
                Erases your account and everything in it — every job, receipt, hour, photo, estimate and
                invoice. It cannot be undone and we cannot get it back for you. <b>Download your data first
                if you might want it.</b>
              </p>
              {!deleteOpen ? (
                <button
                  className="btn-secondary"
                  onClick={() => setDeleteOpen(true)}
                  style={{ width: '100%', color: '#B42318', borderColor: '#f1d4d4' }}
                >
                  Delete my account
                </button>
              ) : (
                <div>
                  <div className="input-group">
                    <label htmlFor="del-confirm">Type <b>{profile.email}</b> to confirm</label>
                    <input
                      id="del-confirm"
                      type="email"
                      autoComplete="off"
                      value={deleteConfirm}
                      onChange={e => setDeleteConfirm(e.target.value)}
                      placeholder={profile.email || 'your@email.com'}
                    />
                  </div>
                  <button
                    className="btn-secondary"
                    onClick={deleteAccount}
                    disabled={deleting || deleteConfirm.trim().toLowerCase() !== String(profile.email || '').toLowerCase()}
                    style={{ width: '100%', background: '#B42318', color: '#fff', borderColor: '#B42318' }}
                  >
                    {deleting ? 'Deleting…' : 'Permanently delete everything'}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => { setDeleteOpen(false); setDeleteConfirm('') }}
                    disabled={deleting}
                    style={{ width: '100%', marginTop: 8 }}
                  >
                    Keep my account
                  </button>
                </div>
              )}
            </div>
            <div className="card">
              <h3 style={{ marginBottom: '4px' }}>Account</h3>
              <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px' }}>Sign out of JobTally on this device.</p>
              <button className="btn-secondary" onClick={() => supabase.auth.signOut()} style={{ width: '100%' }}>Sign out</button>
            </div>
          </div>
        )}

        {activeTab === 'compliance' && (
          <div>
            <button onClick={() => setActiveTab('more')} style={{ background: 'none', border: 'none', color: '#E07B2A', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '8px', padding: '4px' }}>‹ More</button>
            <button className="btn-primary" onClick={() => { setShowNewCompliance(true); setInlineError('') }}>+ Add insurance / license</button>
            {complianceItems.map(it => {
              const days = it.expires_on ? Math.ceil((new Date(it.expires_on + 'T00:00:00') - new Date()) / 86400000) : null
              const color = days == null ? '#888' : days < 0 ? '#DC2626' : days <= 30 ? '#E07B2A' : '#16A34A'
              const label = days == null ? '' : days < 0 ? 'EXPIRED' : days <= 30 ? `${days}d left` : 'OK'
              return (
                <div key={it.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <h3>{it.name}</h3>
                      <p style={{ textTransform: 'capitalize' }}>{it.kind}{it.reference ? ` · ${it.reference}` : ''}</p>
                      {it.expires_on && <p style={{ fontSize: '12px', color, fontWeight: '600', marginTop: '2px' }}>Expires {new Date(it.expires_on + 'T00:00:00').toLocaleDateString()}{label ? ` · ${label}` : ''}</p>}
                    </div>
                    <button aria-label="Delete item" onClick={() => deleteCompliance(it)} style={{ background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px', flexShrink: 0 }}>Delete</button>
                  </div>
                </div>
              )
            })}
            {complianceItems.length === 0 && <div className="empty-state"><p>Track your insurance and licenses here — get a heads-up before they expire.</p></div>}
          </div>
        )}

        {activeTab === 'warranties' && (
          <div>
            <button onClick={() => setActiveTab('more')} style={{ background: 'none', border: 'none', color: '#E07B2A', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '8px', padding: '4px' }}>‹ More</button>
            <button className="btn-primary" onClick={() => { setShowNewWarranty(true); setInlineError('') }}>+ Add callback</button>
            {warranties.map(w => {
              const sc = w.status === 'closed' ? 'status-end' : w.status === 'scheduled' ? 'status-mid' : 'status-start'
              return (
                <div key={w.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, paddingRight: '10px' }}>
                      <h3>{w.description}</h3>
                      <p>{w.projects ? w.projects.name : ''}{w.due_on ? ` · due ${new Date(w.due_on + 'T00:00:00').toLocaleDateString()}` : ''}</p>
                      <span className={'status-pill ' + sc} role="button" tabIndex={0} aria-label={`Status: ${w.status}. Activate to advance.`} style={{ marginTop: '4px', cursor: 'pointer' }} onClick={() => cycleWarrantyStatus(w)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycleWarrantyStatus(w) } }}>{w.status} ↻</span>
                    </div>
                    <button aria-label="Delete callback" onClick={() => deleteWarranty(w)} style={{ background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px', flexShrink: 0 }}>Delete</button>
                  </div>
                </div>
              )
            })}
            {warranties.length === 0 && <div className="empty-state"><p>Log callbacks and warranty work so nothing slips after the job's done. Tap a status to advance it.</p></div>}
          </div>
        )}

        {activeTab === 'insights' && (
          <div>
            <BackBtn label="Money" onClick={() => setActiveTab('money')} />
            <div className="card">
              <p style={sectionLabel}>Who still owes you</p>
              <p style={{ fontSize: '24px', fontWeight: '800', color: '#1C2B3A', marginBottom: '12px' }}>{formatCurrency(arTotal)}</p>
              {arBuckets.map(b => (
                <div key={b.label} style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#4B5563', marginBottom: '3px' }}><span>{b.label}</span><span>{formatCurrency(b.total)}</span></div>
                  <div className="budget-bar"><div className="budget-bar-fill" style={{ width: (arTotal ? (b.total / arTotal * 100) : 0) + '%', background: b.color }} /></div>
                </div>
              ))}
              {arTotal === 0 && <p style={{ fontSize: '13px', color: '#888' }}>No unpaid invoices.</p>}
            </div>
            <div className="card">
              <p style={sectionLabel}>Collected — last 6 months</p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '120px', marginTop: '8px' }}>
                {revMonths.map(m => (
                  <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                    <span style={{ fontSize: '10px', color: '#888', marginBottom: '2px' }}>{m.total > 0 ? formatCurrency(m.total).replace('.00', '') : ''}</span>
                    <div style={{ width: '70%', background: '#1C2B3A', borderRadius: '6px 6px 0 0', height: `${Math.max(2, (m.total / revMax) * 100)}%`, minHeight: '2px' }} />
                    <span style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <p style={sectionLabel}>Jobs won</p>
              {winRate == null
                ? <p style={{ fontSize: '13px', color: '#888' }}>No decided estimates yet.</p>
                : <p style={{ fontSize: '28px', fontWeight: '800', color: '#16A34A' }}>{winRate}%</p>}
              <p style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>{estAccepted} won · {estDeclined} lost · {estOpen} open</p>
            </div>
            {profitJobs.length > 0 && (
              <div className="card">
                <p style={sectionLabel}>Profit by completed job</p>
                {profitJobs.map(j => (
                  <div key={j.name} style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#4B5563', marginBottom: '3px' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '68%' }}>{j.name}</span><span style={{ color: j.profit >= 0 ? '#16A34A' : '#DC2626', fontWeight: '600' }}>{formatCurrency(j.profit)}</span></div>
                    <div className="budget-bar"><div className="budget-bar-fill" style={{ width: (Math.abs(j.profit) / profitMax * 100) + '%', background: j.profit >= 0 ? '#16A34A' : '#DC2626' }} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'home' && (
          <div>
            {(() => {
              // Free-trial countdown — so the trial never ends as a surprise
              // charge. Hidden for paid/comp owners and when billing isn't
              // enforced. Two sources, in order: the real Stripe trial end
              // (today's model) and, for grandfathered accounts only, what's
              // left of the old no-card window (utils/trialWindow.js — the same
              // rule public.has_app_access enforces on writes).
              const paid = sub && ['active', 'comp'].includes(sub.status)
              if (!billingEnforced || paid) return null
              let daysLeft = null, isCardTrial = false
              if (sub && sub.status === 'trialing' && sub.current_period_end) {
                daysLeft = Math.max(0, Math.ceil((new Date(sub.current_period_end).getTime() - Date.now()) / 86400000))
                isCardTrial = true
              } else {
                daysLeft = legacyFreeDaysLeft(profile)
              }
              if (daysLeft === null) return null
              const urgent = daysLeft <= 2
              // Say the charge out loud. An owner who forgot a card is on file
              // and gets billed is a chargeback and a bad review; one who was
              // told the date every time they opened the app is not.
              //
              // ⚠️ 2026-08-20: new checkouts NO LONGER create a trial — the free
              // tier (one active job, forever) replaced it, and
              // api/create-checkout-session.js no longer sends trial_period_days.
              // This banner is deliberately kept anyway: subscriptions created
              // BEFORE today can still be status='trialing' in Stripe, and
              // legacyFreeDaysLeft() still covers grandfathered no-card accounts.
              // Deleting it would silently stop warning those people before their
              // first charge. It self-retires once both groups age out.
              const label = isCardTrial
                ? `Free trial — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left, then billing starts`
                : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your free trial`
              return (
                <div role="button" tabIndex={0} onClick={() => window.location.assign('?billing')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.assign('?billing') } }}
                  style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '10px 14px', borderRadius: '10px', border: '1px solid ' + (urgent ? '#FCA5A5' : '#FED7AA'), background: urgent ? '#FEF2F2' : '#FFF7ED' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: urgent ? '#B91C1C' : '#9A3412' }}>{urgent ? '⏰ ' : '✨ '}{label}</span>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#E07B2A', whiteSpace: 'nowrap' }}>{isCardTrial ? 'Manage →' : 'See plans →'}</span>
                </div>
              )
            })()}
            {!initialLoading && (() => {
              // ONE next thing, not a five-item chore list.
              //
              // This used to render all five steps at once with a "2 of 5 done"
              // counter — which reads as homework to a contractor who opened the
              // app to look at a job, and puts four things they aren't doing
              // right now above the numbers they came for. The steps still exist
              // as the state machine; only the first unfinished one is shown.
              //
              // The old 'compliance' step (insurance & license docs) is gone from
              // onboarding entirely. Nobody sets up their COI on the day they
              // sign up, so it sat permanently unchecked and kept the card on
              // screen forever. The Compliance tab is still there for whoever
              // wants it.
              const steps = [
                { key: 'job', label: 'Create your first job', hint: 'Everything else hangs off a job — start here.', action: 'Create job', cta: () => { setActiveTab('jobs'); setShowNewJob(true); setInlineError('') }, done: realProjects.length > 0 },
                { key: 'crew', label: 'Add your crew', hint: 'Text them a link — they clock in from their own phone.', action: 'Invite', cta: () => setActiveTab('workers'), done: workers.length > 0 },
                { key: 'estimate', label: 'Send your first estimate', hint: 'Price a job and send it out.', action: 'New estimate', cta: () => setActiveTab('estimates'), done: estimates.length > 0 },
                { key: 'invoice', label: 'Bill your first job', hint: 'Turn finished work into money owed to you.', action: 'New invoice', cta: () => setActiveTab('invoices'), done: invoices.length > 0 },
              ]
              const next = steps.find(s => !s.done)
              if (!next) return null
              const doneCount = steps.filter(s => s.done).length
              return (
                <div className="card" role="button" tabIndex={0} onClick={next.cta} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next.cta() } }}
                  style={{ border: '2px solid #E07B2A', marginBottom: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '11px', fontWeight: '700', color: '#E07B2A', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      {doneCount > 0 ? 'Next' : 'Start here'}
                    </p>
                    <p style={{ fontSize: '17px', fontWeight: '800', color: '#1C2B3A', marginTop: '2px' }}>{next.label}</p>
                    <p style={{ fontSize: '13px', color: '#717171', marginTop: '2px', lineHeight: '1.4' }}>{next.hint}</p>
                  </div>
                  <span style={{ background: '#E07B2A', color: 'white', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontWeight: '700', whiteSpace: 'nowrap', flexShrink: 0 }}>{next.action} ›</span>
                </div>
              )
            })()}
            {(() => {
              const pending = timeOff.filter(r => r.status === 'pending').length
              if (!pending) return null
              return (
                <div className="card" role="button" tabIndex={0} onClick={() => setActiveTab('workers')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('workers') } }} style={{ border: '2px solid #E07B2A', background: '#FFF4ED', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#1C2B3A' }}>🌴 {pending} time-off request{pending > 1 ? 's' : ''} waiting for your review</span>
                  <span style={{ color: '#E07B2A', fontSize: '18px' }}>›</span>
                </div>
              )
            })()}
            {/* Who is working, right now. The first thing an owner standing in a
                driveway at 7am actually wants off this screen. Only renders when
                somebody is clocked in — an empty "0 on the clock" card every
                evening is noise. */}
            {onTheClock.length > 0 && (
              <div className="card" role="button" tabIndex={0} onClick={() => setActiveTab('workers')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('workers') } }}
                style={{ border: '2px solid #16A34A', background: '#F0FDF4', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                  <p style={{ fontSize: '15px', fontWeight: '800', color: '#166534' }}>
                    🟢 {onTheClock.length} on the clock right now
                  </p>
                  <span style={{ color: '#16A34A', fontSize: '18px' }}>›</span>
                </div>
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {onTheClock.slice(0, 4).map(t => {
                    const w = workers.find(x => x.id === t.worker_id)
                    const job = projects.find(p => p.id === t.project_id)
                    return (
                      <p key={t.id} style={{ fontSize: '13px', color: '#1C2B3A' }}>
                        <strong>{w ? w.full_name : 'Worker'}</strong>
                        {job ? ` · ${job.name}` : ''}
                        <span style={{ color: '#717171' }}> · since {new Date(t.clocked_in_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                      </p>
                    )
                  })}
                  {onTheClock.length > 4 && <p style={{ fontSize: '13px', color: '#717171' }}>+{onTheClock.length - 4} more</p>}
                </div>
              </div>
            )}
            <div className="card" style={{ background: '#1C2B3A', color: 'white' }}>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Owed to you</p>
              {/* Always a number in the same place. The old copy swapped the
                  figure out for "Nothing outstanding — you're all paid up 👍",
                  which reads as a greeting card and moves the layout around. */}
              <p style={{ fontSize: '44px', fontWeight: '800', color: owedTotal > 0 ? '#F59E0B' : 'rgba(255,255,255,0.9)', lineHeight: '1.05', marginTop: '2px' }}>{formatCurrency(owedTotal)}</p>
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', marginTop: '2px' }}>
                {owedTotal > 0 ? 'Invoices sent and not paid yet' : 'No unpaid invoices'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 24px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <div><p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>Active jobs</p><p style={{ fontSize: '16px', fontWeight: '700' }}>{activeProjects.length}</p></div>
                <div><p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>On the clock</p><p style={{ fontSize: '16px', fontWeight: '700' }}>{onTheClock.length}</p></div>
                <div><p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>Open estimates</p><p style={{ fontSize: '16px', fontWeight: '700' }}>{openEstimateCount}</p></div>
                {/* Was "Grand total", which told the owner nothing about WHICH
                    total. It's the contract value of every job still open. */}
                <div><p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>Active job value</p><p style={{ fontSize: '16px', fontWeight: '700', color: '#16A34A' }}>{formatCurrency(grandTotal)}</p></div>
              </div>
            </div>
            {budgetAlerts.length > 0 && (
              <>
                <p style={sectionLabel}>Budget alerts</p>
                {budgetAlerts.map(p => {
                  const s = spendOf(p.id)
                  const over = getBudgetPct(s.materials, p.materials_budget) >= 100 || getBudgetPct(s.labor, p.labor_budget) >= 100
                  return <div key={p.id} className={over ? 'alert-danger' : 'alert-warning'} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => fetchProjectDetails(p)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fetchProjectDetails(p) } }}>{over ? '🔴' : '⚠️'} {p.name} — {over ? 'over budget' : 'approaching limit'}</div>
                })}
              </>
            )}
            <p style={sectionLabel}>This week</p>
            {thisWeekSchedule.length === 0 && <div className="empty-state"><p>Nothing scheduled this week. Open a job and use its Plan tab to put crew on days — what you schedule shows up here and on their phones.</p></div>}
            {thisWeekSchedule.map(s => (
              <div key={s.id} className="card" style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <p style={{ fontWeight: '600', fontSize: '14px' }}>{s.profiles ? s.profiles.full_name : 'Worker'} · {s.task_description}</p>
                    <p style={{ fontSize: '12px', color: '#888' }}>{s.projects ? s.projects.name : ''}</p>
                  </div>
                  <p style={{ fontSize: '12px', color: '#E07B2A', fontWeight: '600', whiteSpace: 'nowrap', marginLeft: '10px' }}>{new Date(s.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                </div>
              </div>
            ))}
            {/* The old More bucket, rehomed. It's the least-visited corner of
                the app (insurance, warranty, settings), so the bottom of Home
                is a fairer place for it than a permanent nav slot. */}
            <p style={sectionLabel}>Everything else</p>
            <HubCard icon="⋯" title="More tools" sub="Insurance & licenses, callbacks, settings & billing" onClick={() => setActiveTab('more')} />
          </div>
        )}

        {activeTab === 'clients' && (
          <div>
            <BackBtn label="Money" onClick={() => setActiveTab('money')} />
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 4px' }}>Everyone you've worked with — jobs, what they're worth, and what they still owe.</p>
            {clientsList.map(c => (
              <div key={c.name} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <h3>{c.name}</h3>
                    <p>{c.jobs} job{c.jobs !== 1 ? 's' : ''} · {formatCurrency(c.contract)} total</p>
                    {c.owed > 0 && <p style={{ color: '#DC2626', fontWeight: '600', fontSize: '13px', marginTop: '2px' }}>{formatCurrency(c.owed)} owed</p>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginLeft: '8px', justifyContent: 'flex-end' }}>
                    {c.phone && <a href={`tel:${c.phone}`} style={{ background: '#16A34A', color: 'white', textDecoration: 'none', padding: '8px 11px', borderRadius: '8px', fontSize: '14px' }}>📞</a>}
                    {c.phone && <a href={`sms:${c.phone}`} style={{ background: '#1C2B3A', color: 'white', textDecoration: 'none', padding: '8px 11px', borderRadius: '8px', fontSize: '14px' }}>💬</a>}
                    {c.email && <a href={`mailto:${c.email}`} style={{ background: '#E07B2A', color: 'white', textDecoration: 'none', padding: '8px 11px', borderRadius: '8px', fontSize: '14px' }}>✉️</a>}
                  </div>
                </div>
              </div>
            ))}
            {clientsList.length === 0 && <div className="empty-state"><p>No clients yet. Add a job with a client name and they'll show up here.</p></div>}
          </div>
        )}

        {activeTab === 'calendar' && (
          <div>
            <BackBtn label="Jobs" onClick={() => setActiveTab('jobs')} />
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 4px' }}>Everything coming up across all your jobs.</p>
            {upcomingSchedule.length === 0 && <div className="empty-state"><p>Nothing scheduled yet. Assign crew from a job's Schedule tab.</p></div>}
            {(() => {
              const byDay = {}
              upcomingSchedule.forEach(s => { const k = s.scheduled_date || 'unscheduled'; (byDay[k] = byDay[k] || []).push(s) })
              return Object.keys(byDay).sort().map(day => (
                <div key={day}>
                  <p className="schedule-day">{day !== 'unscheduled' ? new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : 'Unscheduled'}</p>
                  {byDay[day].map(s => (
                    <div key={s.id} className="card" style={{ padding: '12px 16px' }}>
                      <p style={{ fontWeight: '600', fontSize: '14px' }}>{s.profiles ? s.profiles.full_name : 'Worker'} · {s.task_description}</p>
                      <p style={{ fontSize: '12px', color: '#888' }}>{s.projects ? s.projects.name : ''}{s.start_time ? ` · ${(s.start_time || '').slice(0, 5)}–${(s.end_time || '').slice(0, 5)}` : ''}</p>
                    </div>
                  ))}
                </div>
              ))
            })()}
          </div>
        )}

        {activeTab === 'jobs' && (
          <div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <button style={{ flex: 1, minHeight: 'var(--tap)', padding: '10px', borderRadius: '10px', border: 'none', background: '#1C2B3A', color: 'white', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>🔨 Jobs</button>
              <button onClick={() => setActiveTab('calendar')} style={{ flex: 1, minHeight: 'var(--tap)', padding: '10px', borderRadius: '10px', border: '1px solid #ddd', background: 'white', color: '#1C2B3A', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>📅 Schedule</button>
            </div>
            <div className="stats-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="stat-card"><div className="stat-value">{activeProjects.length}</div><div className="stat-label">Active Jobs</div></div>
              <div className="stat-card"><div className="stat-value">{completedProjects.length}</div><div className="stat-label">Completed</div></div>
              <div className="stat-card"><div className="stat-value" style={{ fontSize: '16px', color: '#1C2B3A' }}>{formatCurrency(grandTotal)}</div><div className="stat-label">Active job value</div></div>
            </div>
            {canAddJob ? (
              <button className="btn-primary" onClick={() => { setShowNewJob(true); setInlineError('') }}>+ New job</button>
            ) : (
              // Free plan, slot already used. Don't hide the button and don't
              // let it fail — say what's true and give both ways forward, since
              // finishing the current job is a real option, not just upgrading.
              <div style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid #FED7AA', background: '#FFF7ED' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#9A3412', marginBottom: 4 }}>
                  You're on the free plan — one job at a time
                </div>
                <div style={{ fontSize: 12.5, color: '#9A3412', lineHeight: 1.5, marginBottom: 10 }}>
                  Finish “{activeProjects[0] ? activeProjects[0].name : 'your current job'}” and you can start
                  the next one, free, same as this one. Or run as many at once as you want for $150/mo.
                </div>
                <button className="btn-primary" style={{ margin: 0 }} onClick={() => window.location.assign('?billing')}>
                  See plans
                </button>
              </div>
            )}

            {spendError && (
              <div className="alert-danger" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', margin: '12px 0' }}>
                <span>Couldn't load spending — totals may be off.</span>
                <button onClick={() => fetchSpend(projects)} style={{ background: 'none', border: '1px solid #DC2626', color: '#DC2626', borderRadius: '8px', padding: '6px 12px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>Retry</button>
              </div>
            )}

            {sampleProject && (
              <div className="card" style={{ border: '2px dashed #93C5FD', background: '#F0F7FF', marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                  <div>
                    <span style={{ display: 'inline-block', fontSize: '10px', fontWeight: 800, letterSpacing: '1px', color: '#1D4ED8', background: '#DBEAFE', borderRadius: '6px', padding: '3px 8px', marginBottom: '6px' }}>EXAMPLE — NOT YOUR JOB</span>
                    <h3 style={{ color: '#1C2B3A' }}>{sampleProject.name}</h3>
                    <p style={{ fontSize: '13px', color: '#4B5563', marginTop: '4px', lineHeight: '1.5' }}>
                      This is what a finished job looks like once you've logged receipts and crew hours. Open it to see where the money went — it's left out of all your totals and exports.
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: '17px', fontWeight: 800, color: '#15803D' }}>{formatCurrency(profitOf(sampleProject))}</p>
                    <p style={{ fontSize: '10px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Final profit</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button className="btn-secondary" style={{ flex: 1, margin: 0 }} onClick={() => fetchProjectDetails(sampleProject)}>Open the example</button>
                  <button
                    className="btn-secondary"
                    style={{ flex: 1, margin: 0, color: '#DC2626', borderColor: '#FCA5A5' }}
                    disabled={removingSample}
                    onClick={async () => {
                      setRemovingSample(true)
                      const ok = await deleteSampleJob(supabase, sampleProject.id)
                      setRemovingSample(false)
                      if (ok) { await fetchProjects(); showToast('Example removed ✓') }
                      else showToast('Could not remove it — try again', 'error')
                    }}
                  >{removingSample ? 'Removing…' : 'Remove it'}</button>
                </div>
              </div>
            )}

            {activeProjects.length > 0 && (
              <div>
                <p style={{ fontSize: '11px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '1px', margin: '16px 0 8px', padding: '0 4px' }}>Active</p>
                {activeProjects.map(p => {
                  const s = spendOf(p.id)
                  const matPct = getBudgetPct(s.materials, p.materials_budget)
                  const labPct = getBudgetPct(s.labor, p.labor_budget)
                  return (
                    <div key={p.id} className="card" role="button" tabIndex={0} onClick={() => fetchProjectDetails(p)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fetchProjectDetails(p) } }} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div><h3>{p.name}</h3><p>{p.client_name}</p></div>
                        <div style={{ textAlign: 'right' }}>
                          <span className={'status-pill status-' + p.stage}>{stageLabel(p.stage)}</span>
                          <p style={{ fontSize: '17px', fontWeight: 800, marginTop: '6px', color: '#1C2B3A' }}>{formatCurrency(contractOf(p))}</p>
                          <p style={{ fontSize: '10px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Contract</p>
                        </div>
                      </div>
                      {(matPct >= 80 || labPct >= 80) && (
                        <div className={matPct >= 100 || labPct >= 100 ? 'alert-danger' : 'alert-warning'} style={{ marginBottom: '8px' }}>
                          {matPct >= 100 || labPct >= 100 ? '🔴 Over budget' : '⚠️ Approaching limit'}
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#888', marginBottom: '4px' }}><span>Materials</span><span>{formatCurrency(s.materials)} / {formatCurrency(p.materials_budget)}</span></div>
                      <div className="budget-bar"><div className={'budget-bar-fill ' + getBudgetClass(matPct)} style={{ width: matPct + '%' }} /></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#888', margin: '6px 0 4px' }}><span>Labor</span><span>{formatCurrency(s.labor)} / {formatCurrency(p.labor_budget)}</span></div>
                      <div className="budget-bar"><div className={'budget-bar-fill ' + getBudgetClass(labPct)} style={{ width: labPct + '%' }} /></div>
                    </div>
                  )
                })}
              </div>
            )}

            {completedProjects.length > 0 && (
              <div>
                <p style={{ fontSize: '11px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '1px', margin: '16px 0 8px', padding: '0 4px' }}>Completed</p>
                {completedProjects.map(p => (
                  <div key={p.id} className="card" role="button" tabIndex={0} onClick={() => fetchProjectDetails(p)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fetchProjectDetails(p) } }} style={{ cursor: 'pointer', background: '#f9fafb' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <h3 style={{ color: '#666' }}>{p.name}</h3>
                        <p>{p.client_name}</p>
                        {p.completed_at && <p style={{ fontSize: '11px', color: '#717171', marginTop: '2px' }}>Completed {new Date(p.completed_at).toLocaleDateString()}</p>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className="status-pill status-end">✓ Done</span>
                        <p style={{ fontSize: '15px', fontWeight: 800, marginTop: '6px', color: profitOf(p) >= 0 ? '#15803D' : '#DC2626' }}>{formatCurrency(profitOf(p))}</p>
                        <p style={{ fontSize: '10px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Final profit</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {initialLoading && projects.length === 0 && <div className="empty-state"><p>Loading…</p></div>}
            {/* realProjects, so an owner who only has the demo job still gets the
                prompt to put their own work in. */}
            {!initialLoading && realProjects.length === 0 && (
              <div className="empty-state" style={{ textAlign: 'center' }}>
                <p style={{ marginBottom: '14px' }}>Add a job to see live profit, crew hours, and receipts as the work happens.</p>
                <button className="btn-primary" onClick={() => { setShowNewJob(true); setInlineError('') }}>+ Create your first job</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'workers' && (
          <div>
            <BackBtn label="Crew" onClick={() => setActiveTab('crew')} />
            {workersError && (
              <div className="alert-danger" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span>Some crew data couldn't load.</span>
                <button onClick={() => { fetchWorkerStats(workers); fetchAssignments(); fetchTimeOff(); fetchOpenInvites() }} style={{ background: 'none', border: '1px solid #DC2626', color: '#DC2626', borderRadius: '8px', padding: '6px 12px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>Retry</button>
              </div>
            )}
            {!showInvite && (
              <button onClick={() => setShowInvite(true)} className="btn-primary" style={{ marginBottom: '12px' }}>+ Add worker</button>
            )}
            {showInvite && (
              <div className="card" style={{ marginBottom: '12px', background: '#FFF9F4', border: '1px solid #F0C9A8' }}>
                {!inviteLink ? (
                  <>
                    <h3 style={{ marginBottom: '4px' }}>Invite a worker</h3>
                    <p style={{ fontSize: '13px', color: '#888', marginBottom: '10px' }}>Enter their name and we’ll make a private sign-up link you can text them. No app account needed on your end.</p>
                    <div className="input-group">
                      <label htmlFor="invite-name">Worker’s name</label>
                      <input id="invite-name" type="text" value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Mike Reyes" />
                    </div>
                    {inlineError && <div className="alert-danger" style={{ marginBottom: '10px' }}>{inlineError}</div>}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={createInvite} disabled={loading} className="btn-primary" style={{ flex: 1 }}>{loading ? 'Creating…' : 'Create invite link'}</button>
                      <button onClick={resetInvite} style={{ background: 'transparent', color: '#888', border: '1px solid #ddd', borderRadius: '8px', padding: '0 16px', cursor: 'pointer' }}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 style={{ marginBottom: '4px' }}>Link ready for {inviteName} 🎉</h3>
                    <p style={{ fontSize: '13px', color: '#888', marginBottom: '10px' }}>Text it to {inviteName}. He taps it once and he’s on your crew — no password to make up, nothing to download. We’ll write the text for you.</p>
                    <div style={{ background: 'white', border: '1px solid #eee', borderRadius: '8px', padding: '10px', fontSize: '12px', color: '#1C2B3A', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: '10px' }}>{inviteMessage(inviteName, inviteLink)}</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => copyInvite()} className="btn-primary" style={{ flex: 1 }}>{inviteCopied ? 'Sent ✓' : 'Text it over'}</button>
                      <button onClick={resetInvite} style={{ background: 'transparent', color: '#888', border: '1px solid #ddd', borderRadius: '8px', padding: '0 16px', cursor: 'pointer' }}>Done</button>
                    </div>
                  </>
                )}
              </div>
            )}
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 4px' }}>
              Add a worker with an invite link above — he taps it once and he’s on, no password. If you’ve only got one job running he’s put on it automatically; with more than one, tap <b>Assign</b> on his card to say which, and that’s what lets him clock in.
            </p>
            {/* Who has a link and hasn't used it yet. This is the "did Mike
                ever sign up?" answer, and the re-send button that goes with it
                — chasing a crew member used to mean making him a second link. */}
            {openInvites.length > 0 && (
              <div className="card" style={{ marginBottom: '12px', border: '1px solid #F0C9A8' }}>
                <h3 style={{ marginBottom: '2px' }}>Sent, not joined yet</h3>
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>These links keep working until they’re used. Re-send one, or turn it off.</p>
                {openInvites.map(inv => (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '8px', marginTop: '8px', borderTop: '1px solid #f0f0f0' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '700', color: '#1C2B3A', fontSize: '14px' }}>{inv.worker_name || 'Unnamed'}</div>
                      <div style={{ fontSize: '12px', color: '#888' }}>Sent {new Date(inv.created_at).toLocaleDateString()}</div>
                    </div>
                    <button
                      onClick={() => copyInvite(inv.worker_name, `${window.location.origin}/?invite=${inv.token}`)}
                      style={{ background: '#E07B2A', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}
                    >Send again</button>
                    <button
                      onClick={() => revokeInvite(inv)}
                      style={{ background: 'transparent', color: '#888', border: '1px solid #ddd', borderRadius: '8px', padding: '8px 10px', fontSize: '13px', cursor: 'pointer' }}
                    >Turn off</button>
                  </div>
                ))}
              </div>
            )}
            {timeOff.filter(r => r.status === 'pending').length > 0 && (
              <div className="card" style={{ marginBottom: '12px', border: '1px solid #F0C9A8' }}>
                <h3 style={{ marginBottom: '8px' }}>Time-off requests</h3>
                {timeOff.filter(r => r.status === 'pending').map(r => {
                  const wk = workers.find(x => x.id === r.worker_id)
                  return (
                    <div key={r.id} style={{ paddingTop: '8px', marginTop: '8px', borderTop: '1px solid #f0f0f0' }}>
                      <p style={{ fontWeight: '600' }}>{wk ? wk.full_name : 'A worker'}</p>
                      <p style={{ fontSize: '13px', color: '#1C2B3A' }}>{formatDateRange(r.start_date, r.end_date)}</p>
                      {r.reason && <p style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>“{r.reason}”</p>}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <button onClick={() => decideTimeOff(r, 'approved')} disabled={loading} style={{ background: '#16A34A', color: 'white', border: 'none', borderRadius: '8px', padding: '6px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Approve</button>
                        <button onClick={() => decideTimeOff(r, 'denied')} disabled={loading} style={{ background: 'transparent', color: '#DC2626', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '6px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Deny</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {workers.map(w => {
              const stats = workerStats[w.id]
              const isAssigned = assignedWorkerIds.includes(w.id)
              return (
                <div key={w.id} className="card">
                  {!isAssigned && (
                    <div role="button" tabIndex={0} onClick={() => { setShowAssignWorker(w); setAssignProjectId(''); setInlineError('') }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowAssignWorker(w); setAssignProjectId(''); setInlineError('') } }} style={{ cursor: 'pointer', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '8px', padding: '8px 10px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: '#9A3412', fontWeight: 600 }}>Not on a job yet — they can't clock in until you assign them.</span>
                      <span style={{ fontSize: '12px', color: '#E07B2A', fontWeight: 700, whiteSpace: 'nowrap' }}>Assign →</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <h3>{w.full_name}</h3>
                      <p>{w.email}</p>
                      {w.hourly_rate > 0
                        ? <p style={{ color: '#E07B2A', fontWeight: '600', marginTop: '4px' }}>{formatCurrency(w.hourly_rate)}/hr</p>
                        : <button onClick={() => { setShowEditRate(w); setEditRate(''); setInlineError('') }} style={{ marginTop: '4px', background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '4px 10px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>⚠️ Set hourly rate — their pay reads $0 until you do</button>}
                      {stats && (
                        <div style={{ display: 'flex', gap: '16px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                          <div>
                            <p style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>This Month</p>
                            <p style={{ fontSize: '15px', fontWeight: '700', color: '#1C2B3A' }}>{formatTime(stats.monthMinutes)}</p>
                            <p style={{ fontSize: '12px', color: '#DC2626', fontWeight: '600' }}>{formatCurrency(stats.monthCost)}</p>
                          </div>
                          <div style={{ width: '1px', background: '#f0f0f0' }} />
                          <div>
                            <p style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>All Time</p>
                            <p style={{ fontSize: '15px', fontWeight: '700', color: '#1C2B3A' }}>{formatTime(stats.totalMinutes)}</p>
                            <p style={{ fontSize: '12px', color: '#DC2626', fontWeight: '600' }}>{formatCurrency(stats.totalCost)}</p>
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginLeft: '8px' }}>
                      <button onClick={() => { setShowEditRate(w); setEditRate(w.hourly_rate || ''); setInlineError('') }} style={{ background: '#E07B2A', color: 'white', border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', minHeight: '44px', cursor: 'pointer' }}>Edit rate</button>
                      <button onClick={() => { setShowAssignWorker(w); setAssignProjectId(''); setInlineError('') }} style={{ background: '#1C2B3A', color: 'white', border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', minHeight: '44px', cursor: 'pointer' }}>Assign</button>
                      <button onClick={() => removeWorker(w)} style={{ background: 'transparent', color: '#DC2626', border: '1px solid #FCA5A5', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', minHeight: '44px', cursor: 'pointer' }}>Remove</button>
                    </div>
                  </div>
                </div>
              )
            })}
            {initialLoading && workers.length === 0 && <div className="empty-state"><p>Loading…</p></div>}
            {!initialLoading && workers.length === 0 && <div className="empty-state"><p>No workers yet. Ask your crew to sign up and enter your email to link up.</p></div>}
          </div>
        )}

        {activeTab === 'payroll' && (
          <div>
            <BackBtn label="Crew" onClick={() => setActiveTab('crew')} />
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 4px' }}>
              Weekly pay per worker, straight from their clocked hours. Tap "Mark Paid" each week to record a paycheck.
            </p>
            {workers.length === 0 && <div className="empty-state"><p>Add workers first — their clocked hours become weekly paychecks here.</p></div>}
            {workers.map(w => {
              const rows = payroll.filter(r => r.worker_id === w.id)
              const unpaidTotal = rows.reduce((s, r) => {
                const paid = paychecks.find(c => c.worker_id === r.worker_id && c.week_start === r.week_start)
                // Hours added to a week AFTER it was paid are still owed (T1.6).
                return s + (paid ? Math.max(0, r.gross - (paid.gross_pay || 0)) : r.gross)
              }, 0)
              return (
                <div key={w.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: rows.length ? '8px' : '0' }}>
                    <div><h3>{w.full_name}</h3><p>{formatCurrency(w.hourly_rate)}/hr</p></div>
                    {unpaidTotal > 0 && <div style={{ textAlign: 'right' }}><p style={{ fontSize: '11px', color: '#888' }}>Owed</p><p style={{ fontWeight: '700', color: '#DC2626', fontSize: '16px' }}>{formatCurrency(unpaidTotal)}</p></div>}
                  </div>
                  {rows.length === 0 && <p style={{ fontSize: '13px', color: '#888' }}>No hours clocked yet.</p>}
                  {rows.map(r => {
                    const paid = paychecks.find(c => c.worker_id === r.worker_id && c.week_start === r.week_start)
                    const paidExtra = paid ? r.gross - (paid.gross_pay || 0) : 0 // hours added since the paycheck was recorded
                    return (
                      <div key={r.week_start} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid #f0f0f0' }}>
                        <div>
                          <p style={{ fontWeight: '600', fontSize: '14px' }}>Week of {new Date(r.week_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                          <p style={{ fontSize: '12px', color: '#717171' }}>{formatTime(r.minutes)} · {formatCurrency(r.gross)}</p>
                        </div>
                        {paid
                          ? <div style={{ textAlign: 'right' }}>
                              <span style={{ fontSize: '12px', fontWeight: '700', color: '#16A34A' }}>Paid ✓</span>
                              {paidExtra > 0.005 && <p style={{ fontSize: '11px', fontWeight: '700', color: '#DC2626', marginTop: '2px' }}>+{formatCurrency(paidExtra)} added since paid</p>}
                            </div>
                          : <button onClick={() => recordPaycheck(r)} disabled={loading} style={{ background: '#16A34A', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', minHeight: '40px' }}>Mark paid</button>
                        }
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'estimates' && (
          <div>
            <BackBtn label="Money" onClick={() => setActiveTab('money')} />
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 4px' }}>
              Quote a job, send it, and turn a "yes" into a job with one tap.
            </p>
            <button className="btn-primary" onClick={openNewEstimate}>+ New estimate</button>
            {estimates.map(est => {
              const total = estimateTotal(est.items, est.tax_rate, est.tax_mode)
              const statusColor = est.status === 'accepted' ? 'status-end' : est.status === 'sent' ? 'status-mid' : 'status-start'
              return (
                <div key={est.id} className="card" style={est.status === 'accepted' ? { background: '#f9fafb' } : undefined}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ flex: 1, paddingRight: '10px' }}>
                      <h3>{est.title || 'Untitled estimate'}</h3>
                      <p>{est.client_name}</p>
                      <span className={'status-pill ' + statusColor} style={{ marginTop: '4px' }}>{est.status}</span>
                    </div>
                    <p style={{ fontWeight: '700', fontSize: '18px', color: '#1C2B3A' }}>{formatCurrency(total)}</p>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                    {est.status !== 'accepted' && <button onClick={() => openEditEstimate(est)} style={btnSm('#1C2B3A')}>Edit</button>}
                    {est.status === 'draft' && <button onClick={() => markEstimateStatus(est, 'sent')} style={btnSm('#E07B2A')}>Mark sent</button>}
                    {(est.status === 'draft' || est.status === 'sent') && <button onClick={() => emailEstimate(est)} style={btnSm('#6366F1')}>✉️ Email</button>}
                    {est.status !== 'accepted' && <button onClick={() => acceptEstimate(est)} style={btnSm('#16A34A')}>Accept → Job</button>}
                    {est.status !== 'accepted' && est.status !== 'declined' && <button onClick={() => markEstimateStatus(est, 'declined')} style={btnSmOutline()}>Decline</button>}
                    <button onClick={() => deleteEstimate(est)} style={btnSmOutline()}>Delete</button>
                  </div>
                </div>
              )
            })}
            {estimates.length === 0 && (estimatesLoaded
              ? <div className="empty-state"><p>No estimates yet. Quote your next job and send it to win the work.</p></div>
              : <div className="empty-state"><p>Loading…</p></div>)}
          </div>
        )}

        {activeTab === 'invoices' && (
          <div>
            <BackBtn label="Money" onClick={() => setActiveTab('money')} />
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 4px' }}>
              Bill clients and track what you're owed. Tap "Mark Paid" when the money comes in.
            </p>
            {(() => {
              const unpaid = invoices.filter(i => i.status !== 'paid')
              const paid = invoices.filter(i => i.status === 'paid')
              const owed = unpaid.reduce((s, i) => s + (i.amount || 0), 0)
              const collected = paid.reduce((s, i) => s + (i.amount || 0), 0)
              return (
                <>
                  <div className="card" style={{ background: '#1C2B3A', color: 'white' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Outstanding</p>
                        <p style={{ fontSize: '26px', fontWeight: '800', color: '#F59E0B' }}>{formatCurrency(owed)}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>Collected</p>
                        <p style={{ fontSize: '26px', fontWeight: '800', color: '#16A34A' }}>{formatCurrency(collected)}</p>
                      </div>
                    </div>
                  </div>
                  <button className="btn-primary" onClick={() => { setShowNewInvoice(true); setInlineError('') }}>+ New invoice</button>
                  {unpaid.length > 0 && <p style={{ fontSize: '11px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '1px', margin: '16px 0 8px', padding: '0 4px' }}>Owed to you</p>}
                  {unpaid.map(inv => (
                    <div key={inv.id} className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, paddingRight: '10px' }}>
                          <h3>{inv.label} · {formatCurrency(inv.amount)}</h3>
                          <p>{inv.projects ? inv.projects.name : ''}{inv.projects && inv.projects.client_name ? ` · ${inv.projects.client_name}` : ''}</p>
                          <p style={{ fontSize: '11px', color: '#717171' }}>{inv.due_date ? `Due ${new Date(inv.due_date + 'T00:00:00').toLocaleDateString()}` : (inv.issued_date ? `Sent ${new Date(inv.issued_date + 'T00:00:00').toLocaleDateString()}` : '')}</p>
                        </div>
                        <button onClick={() => markInvoicePaid(inv)} disabled={loading} style={{ background: '#16A34A', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', minHeight: '40px' }}>Mark paid</button>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                        {inv.projects && inv.projects.client_email && <button onClick={() => emailInvoice(inv)} style={btnSm('#6366F1')}>✉️ Email</button>}
                        {inv.payment_link && <a href={inv.payment_link} target="_blank" rel="noopener noreferrer" style={{ ...btnSm('#16A34A'), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>💳 Pay link</a>}
                        <button onClick={() => deleteInvoice(inv)} style={btnSmOutline()}>Delete</button>
                      </div>
                    </div>
                  ))}
                  {paid.length > 0 && <p style={{ fontSize: '11px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '1px', margin: '16px 0 8px', padding: '0 4px' }}>Paid</p>}
                  {paid.map(inv => (
                    <div key={inv.id} className="card" style={{ background: '#f9fafb' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h3 style={{ color: '#666' }}>{inv.label} · {formatCurrency(inv.amount)}</h3>
                          <p>{inv.projects ? inv.projects.name : ''}{inv.projects && inv.projects.client_name ? ` · ${inv.projects.client_name}` : ''}</p>
                          {inv.paid_at && <p style={{ fontSize: '11px', color: '#717171' }}>Paid {new Date(inv.paid_at).toLocaleDateString()}</p>}
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#16A34A' }}>Paid ✓</span>
                      </div>
                    </div>
                  ))}
                  {invoices.length === 0 && (invoicesLoaded
                    ? <div className="empty-state"><p>No invoices yet. Create one to bill a client and track what you're owed.</p></div>
                    : <div className="empty-state"><p>Loading…</p></div>)}
                </>
              )
            })()}
          </div>
        )}

        {activeTab === 'reports' && (
          <div>
            <BackBtn label="Money" onClick={() => setActiveTab('money')} />
            <div className="input-group">
              <label>Year</label>
              <select value={reportYear} onChange={e => setReportYear(parseInt(e.target.value, 10))}>
                {reportYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {realProjects.length > 0 && (
              <div className="card">
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '1px' }}>Send to QuickBooks</p>
                <p style={{ fontSize: '13px', color: '#4B5563', marginBottom: '10px' }}>Download, then in QuickBooks: <b>⚙ Settings → Import Data → Invoices</b> (or Customers) and match the columns.</p>
                <button className="btn-secondary" onClick={exportQboInvoices} disabled={loading} style={{ marginBottom: '8px' }}>⬇ Invoices for QuickBooks (CSV)</button>
                <button className="btn-secondary" onClick={exportQboCustomers}>⬇ Customers for QuickBooks (CSV)</button>
              </div>
            )}
            {reportJobs.length > 0 ? (
              <>
                <button className="btn-primary" onClick={exportTaxPack} disabled={loading} style={{ marginBottom: '8px' }}>{loading ? 'Preparing…' : `📦 Download ${reportYear} Tax Pack`}</button>
                <button className="btn-secondary" onClick={exportReportCSV} style={{ marginBottom: '12px' }}>⬇ Job profit report (CSV)</button>
                <div className="card" style={{ background: '#1C2B3A', color: 'white' }}>
                  <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>{reportYear} Summary</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div><p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Jobs Completed</p><p style={{ fontSize: '20px', fontWeight: '700' }}>{reportJobs.length}</p></div>
                    <div><p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Total Revenue</p><p style={{ fontSize: '20px', fontWeight: '700' }}>{formatCurrency(reportJobs.reduce((s, p) => s + contractOf(p), 0))}</p></div>
                    <div><p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Total Materials</p><p style={{ fontSize: '20px', fontWeight: '700' }}>{formatCurrency(reportJobs.reduce((s, p) => s + spendOf(p.id).materials, 0))}</p></div>
                    <div><p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Total Labor</p><p style={{ fontSize: '20px', fontWeight: '700' }}>{formatCurrency(reportJobs.reduce((s, p) => s + spendOf(p.id).labor, 0))}</p></div>
                    <div><p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Total Other</p><p style={{ fontSize: '20px', fontWeight: '700' }}>{formatCurrency(reportJobs.reduce((s, p) => s + spendOf(p.id).other, 0))}</p></div>
                  </div>
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Net Profit</p>
                    <p style={{ fontSize: '28px', fontWeight: '800', color: '#16A34A' }}>
                      {formatCurrency(reportJobs.reduce((s, p) => s + profitOf(p), 0))}
                    </p>
                  </div>
                </div>
                {reportJobs.map(p => {
                  const s = spendOf(p.id)
                  const profit = profitOf(p)
                  const margin = computeMargin(profit, contractOf(p))
                  return (
                    <div key={p.id} className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                        <div><h3>{p.name}</h3><p>{p.client_name}</p></div>
                        <span style={{ fontSize: '14px', fontWeight: '700', color: profit >= 0 ? '#16A34A' : '#DC2626' }}>{margin}%</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '13px' }}>
                        <div><span style={{ color: '#888' }}>Revenue</span><p style={{ fontWeight: '600' }}>{formatCurrency(contractOf(p))}</p></div>
                        <div><span style={{ color: '#888' }}>Profit</span><p style={{ fontWeight: '600', color: profit >= 0 ? '#16A34A' : '#DC2626' }}>{formatCurrency(profit)}</p></div>
                        <div><span style={{ color: '#888' }}>Materials</span><p style={{ fontWeight: '600' }}>{formatCurrency(s.materials)}</p></div>
                        <div><span style={{ color: '#888' }}>Labor</span><p style={{ fontWeight: '600' }}>{formatCurrency(s.labor)}</p></div>
                        {s.other > 0 && <div><span style={{ color: '#888' }}>Other</span><p style={{ fontWeight: '600' }}>{formatCurrency(s.other)}</p></div>}
                      </div>
                    </div>
                  )
                })}
              </>
            ) : (
              <div className="empty-state"><p>No completed jobs in {reportYear}</p></div>
            )}
          </div>
        )}
      </div>

      {showEditRate && (
        <div className="modal-overlay" onClick={() => setShowEditRate(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>Edit {showEditRate.full_name}</h2>
            <div className="input-group"><label>Hourly Rate ($)</label><input type="number" value={editRate} onChange={e => setEditRate(e.target.value)} placeholder="22" /></div>
            {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
            <button className="btn-primary" onClick={saveWorkerRate} disabled={loading}>{loading ? 'Saving…' : 'Save'}</button>
            <button className="btn-secondary" onClick={() => { setShowEditRate(null); setInlineError('') }}>Cancel</button>
          </div>
        </div>
      )}

      {showAssignWorker && (
        <div className="modal-overlay" onClick={() => setShowAssignWorker(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>Assign {showAssignWorker.full_name}</h2>
            <div className="input-group"><label>Select Job</label>
              <select value={assignProjectId} onChange={e => setAssignProjectId(e.target.value)}>
                <option value="">-- Choose a job --</option>
                {activeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
            <button className="btn-primary" onClick={() => assignWorkerToProject(showAssignWorker.id)} disabled={loading}>{loading ? 'Assigning…' : 'Assign'}</button>
            <button className="btn-secondary" onClick={() => { setShowAssignWorker(null); setInlineError('') }}>Cancel</button>
          </div>
        </div>
      )}

      {showNewJob && (
        <div className="modal-overlay" onClick={() => setShowNewJob(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>New Job</h2>
            <div className="input-group"><label>Job Name</label><input value={jobForm.name} onChange={e => setJobForm({ ...jobForm, name: e.target.value })} placeholder="18 Dutch Village" /></div>
            <div className="input-group"><label>Client Name</label><input value={jobForm.client_name} onChange={e => setJobForm({ ...jobForm, client_name: e.target.value })} placeholder="John Smith" /></div>
            <div className="input-group"><label>Client Phone</label><input type="tel" value={jobForm.client_phone} onChange={e => setJobForm({ ...jobForm, client_phone: e.target.value })} placeholder="(518) 555-0199" /></div>
            <div className="input-group"><label>Client Email</label><input type="email" value={jobForm.client_email} onChange={e => setJobForm({ ...jobForm, client_email: e.target.value })} placeholder="john@email.com" /></div>
            <div className="input-group"><label>Job Address</label><input value={jobForm.client_address} onChange={e => setJobForm({ ...jobForm, client_address: e.target.value })} placeholder="24 Pinewood Dr, Troy NY" /></div>
            <div className="input-group"><label>Materials Budget ($)</label><input type="number" value={jobForm.materials_budget} onChange={e => setJobForm({ ...jobForm, materials_budget: e.target.value })} placeholder="3000" /></div>
            <div className="input-group"><label>Labor Budget ($)</label><input type="number" value={jobForm.labor_budget} onChange={e => setJobForm({ ...jobForm, labor_budget: e.target.value })} placeholder="1000" /></div>
            <div className="input-group"><label>Profit Target ($)</label><input type="number" value={jobForm.profit_target} onChange={e => setJobForm({ ...jobForm, profit_target: e.target.value })} placeholder="1000" /></div>
            <p style={{ fontSize: '13px', color: '#15803D', fontWeight: 600, marginBottom: '4px' }}>Contract price = ${((parseFloat(jobForm.materials_budget) || 0) + (parseFloat(jobForm.labor_budget) || 0) + (parseFloat(jobForm.profit_target) || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p style={{ fontSize: '12px', color: '#6B7280', marginBottom: '8px' }}>That's what your client pays — materials + labor + profit added up. You can change it later.</p>
            {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
            <button className="btn-primary" onClick={createJob} disabled={loading}>{loading ? 'Creating…' : 'Create job'}</button>
            <button className="btn-secondary" onClick={() => { setShowNewJob(false); setInlineError('') }}>Cancel</button>
          </div>
        </div>
      )}

      {showNewCompliance && (
        <div className="modal-overlay" onClick={() => { setShowNewCompliance(false); setInlineError('') }}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>Insurance / License</h2>
            <div className="input-group"><label>Type</label><select value={complianceForm.kind} onChange={e => setComplianceForm({ ...complianceForm, kind: e.target.value })}><option value="insurance">Insurance</option><option value="license">License</option><option value="certification">Certification</option></select></div>
            <div className="input-group"><label>Name</label><input value={complianceForm.name} onChange={e => setComplianceForm({ ...complianceForm, name: e.target.value })} placeholder="General Liability" /></div>
            <div className="input-group"><label>Policy / License #</label><input value={complianceForm.reference} onChange={e => setComplianceForm({ ...complianceForm, reference: e.target.value })} placeholder="GL-100482" /></div>
            <div className="input-group"><label>Expires</label><input type="date" value={complianceForm.expires_on} onChange={e => setComplianceForm({ ...complianceForm, expires_on: e.target.value })} /></div>
            <div className="input-group"><label>Notes (optional)</label><input value={complianceForm.notes} onChange={e => setComplianceForm({ ...complianceForm, notes: e.target.value })} placeholder="Carrier, agent, etc." /></div>
            {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
            <button className="btn-primary" onClick={addCompliance} disabled={loading}>{loading ? 'Saving…' : 'Save'}</button>
            <button className="btn-secondary" onClick={() => { setShowNewCompliance(false); setInlineError('') }}>Cancel</button>
          </div>
        </div>
      )}

      {showNewWarranty && (
        <div className="modal-overlay" onClick={() => { setShowNewWarranty(false); setInlineError('') }}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>Add Callback</h2>
            <div className="input-group"><label>Job (optional)</label><select value={warrantyForm.project_id} onChange={e => setWarrantyForm({ ...warrantyForm, project_id: e.target.value })}><option value="">— None —</option>{realProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="input-group"><label>What's the callback?</label><input value={warrantyForm.description} onChange={e => setWarrantyForm({ ...warrantyForm, description: e.target.value })} placeholder="Re-caulk shower (warranty)" /></div>
            <div className="input-group"><label>Due (optional)</label><input type="date" value={warrantyForm.due_on} onChange={e => setWarrantyForm({ ...warrantyForm, due_on: e.target.value })} /></div>
            {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
            <button className="btn-primary" onClick={addWarranty} disabled={loading}>{loading ? 'Saving…' : 'Save'}</button>
            <button className="btn-secondary" onClick={() => { setShowNewWarranty(false); setInlineError('') }}>Cancel</button>
          </div>
        </div>
      )}

      {showNewEstimate && (
        <div className="modal-overlay" onClick={() => { setShowNewEstimate(false); setEditingEstimateId(null); setInlineError('') }}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>{editingEstimateId ? 'Edit Estimate' : 'New Estimate'}</h2>
            <div className="input-group"><label>Title</label><input value={estimateForm.title} onChange={e => setEstimateForm({ ...estimateForm, title: e.target.value })} placeholder="Kitchen remodel — 24 Pinewood Dr" /></div>
            <div className="input-group"><label>Client Name</label><input value={estimateForm.client_name} onChange={e => setEstimateForm({ ...estimateForm, client_name: e.target.value })} placeholder="Sarah Whitman" /></div>
            <div className="input-group"><label>Client Phone</label><input type="tel" value={estimateForm.client_phone} onChange={e => setEstimateForm({ ...estimateForm, client_phone: e.target.value })} placeholder="(518) 555-0199" /></div>
            <div className="input-group"><label>Client Email</label><input type="email" value={estimateForm.client_email} onChange={e => setEstimateForm({ ...estimateForm, client_email: e.target.value })} placeholder="client@email.com" /></div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#444', marginBottom: '5px' }}>Line Items</label>
            <p style={{ fontSize: '12px', color: '#6B7280', margin: '0 2px 8px' }}>Tag each line as Materials, Labor, or Other — if you win this estimate, JobTally uses those tags to set the job's budget and profit split automatically.</p>
            {estimateItems.map((it, i) => (
              <div key={i} style={{ border: '1px solid #eee', borderRadius: '10px', padding: '10px', marginBottom: '8px' }}>
                <input value={it.description} onChange={e => setEstimateItem(i, 'description', e.target.value)} placeholder="Description (e.g. Cabinets & install)" style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #ddd', borderRadius: '8px', fontSize: '14px', marginBottom: '6px' }} />
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input type="number" value={it.qty} onChange={e => setEstimateItem(i, 'qty', e.target.value)} placeholder="Qty" style={{ width: '56px', padding: '8px', border: '1.5px solid #ddd', borderRadius: '8px', fontSize: '14px' }} />
                  <span style={{ color: '#888' }}>×</span>
                  <input type="number" value={it.unit_price} onChange={e => setEstimateItem(i, 'unit_price', e.target.value)} placeholder="Unit $" style={{ flex: 1, minWidth: '0', padding: '8px', border: '1.5px solid #ddd', borderRadius: '8px', fontSize: '14px' }} />
                  <select value={it.kind} onChange={e => setEstimateItem(i, 'kind', e.target.value)} style={{ padding: '8px', border: '1.5px solid #ddd', borderRadius: '8px', fontSize: '13px' }}>{ESTIMATE_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  {estimateItems.length > 1 && <button aria-label="Remove line" onClick={() => removeEstimateRow(i)} style={{ background: 'none', border: 'none', color: '#DC2626', fontSize: '20px', cursor: 'pointer', padding: '0 4px', lineHeight: '1' }}>×</button>}
                </div>
                <p style={{ fontSize: '12px', color: '#16A34A', fontWeight: '600', textAlign: 'right', marginTop: '4px' }}>{formatCurrency(estItemAmount(it))}</p>
              </div>
            ))}
            <button onClick={addEstimateRow} style={{ background: 'none', border: '1px dashed #E07B2A', color: '#E07B2A', borderRadius: '8px', padding: '10px', width: '100%', fontSize: '13px', fontWeight: '600', cursor: 'pointer', marginBottom: '12px' }}>+ Add line</button>
            <div className="input-group">
              <label>Sales tax on this job</label>
              <select value={estimateForm.tax_mode} onChange={e => setEstimateForm({ ...estimateForm, tax_mode: e.target.value })}>
                {TAX_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <p style={{ fontSize: '12px', color: '#6B7280', margin: '6px 2px 0', lineHeight: 1.4 }}>
                {(TAX_MODES.find(m => m.value === estimateForm.tax_mode) || TAX_MODES[0]).help}
                {' '}<span style={{ color: '#9CA3AF' }}>Rules vary by state — check yours with your accountant once, then it's set.</span>
              </p>
            </div>
            {estimateForm.tax_mode !== 'capital' && (
              <div className="input-group"><label>Tax Rate (%) <span style={{ color: '#888', fontWeight: '400' }}>— optional</span></label><input type="number" value={estimateForm.tax_rate} onChange={e => setEstimateForm({ ...estimateForm, tax_rate: e.target.value })} placeholder="8" /></div>
            )}
            <div className="input-group"><label>Notes (optional)</label><input value={estimateForm.notes} onChange={e => setEstimateForm({ ...estimateForm, notes: e.target.value })} placeholder="50% deposit to start, balance on completion" /></div>
            <div style={{ background: '#1C2B3A', color: 'white', borderRadius: '12px', padding: '14px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}><span>Subtotal</span><span>{formatCurrency(estSubtotal(estimateItems))}</span></div>
              {estimateForm.tax_mode === 'capital'
                ? <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginTop: '6px' }}>No sales tax charged — capital improvement.</div>
                : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'rgba(255,255,255,0.7)', marginTop: '4px' }}>
                    {/* Says out loud WHAT is being taxed, so an owner who picks the wrong
                        mode sees it here instead of on a customer's phone. */}
                    <span>Tax ({parseFloat(estimateForm.tax_rate) || 0}% of {formatCurrency(taxableBase(estimateItems, estimateForm.tax_mode))}{estimateForm.tax_mode === 'materials' ? ' materials' : ''})</span>
                    <span>{formatCurrency(taxAmount(estimateItems, estimateForm.tax_rate, estimateForm.tax_mode))}</span>
                  </div>
                )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: '800', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)' }}><span>Total</span><span>{formatCurrency(estimateTotal(estimateItems, estimateForm.tax_rate, estimateForm.tax_mode))}</span></div>
            </div>
            {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
            <button className="btn-primary" onClick={saveEstimate} disabled={loading}>{loading ? 'Saving…' : 'Save estimate'}</button>
            <button className="btn-secondary" onClick={() => { setShowNewEstimate(false); setEditingEstimateId(null); setInlineError('') }}>Cancel</button>
          </div>
        </div>
      )}

      {showNewInvoice && (
        <div className="modal-overlay" onClick={() => { setShowNewInvoice(false); setInlineError('') }}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>New Invoice</h2>
            <div className="input-group"><label>Job</label><select value={invoiceForm.project_id} onChange={e => setInvoiceForm({ ...invoiceForm, project_id: e.target.value })}><option value="">-- Choose a job --</option>{realProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="input-group"><label>Label</label><input value={invoiceForm.label} onChange={e => setInvoiceForm({ ...invoiceForm, label: e.target.value })} placeholder="Deposit / Progress / Final" /></div>
            <div className="input-group"><label>Amount ($)</label><input type="number" value={invoiceForm.amount} onChange={e => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} placeholder="2500" /></div>
            <div className="input-group"><label>Issued Date</label><input type="date" value={invoiceForm.issued_date} onChange={e => setInvoiceForm({ ...invoiceForm, issued_date: e.target.value })} /></div>
            <div className="input-group"><label>Due Date</label><input type="date" value={invoiceForm.due_date} onChange={e => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} /></div>
            <div className="input-group"><label>Notes (optional)</label><input value={invoiceForm.notes} onChange={e => setInvoiceForm({ ...invoiceForm, notes: e.target.value })} placeholder="50% deposit to start" /></div>
            <div className="input-group"><label>Payment link <span style={{ color: '#888', fontWeight: '400' }}>— optional</span></label><input value={invoiceForm.payment_link} onChange={e => setInvoiceForm({ ...invoiceForm, payment_link: e.target.value })} placeholder="Your Stripe / Square / PayPal link" /></div>
            {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
            <button className="btn-primary" onClick={addInvoice} disabled={loading}>{loading ? 'Creating…' : 'Create invoice'}</button>
            <button className="btn-secondary" onClick={() => { setShowNewInvoice(false); setInlineError('') }}>Cancel</button>
          </div>
        </div>
      )}

      {scheduleModal}

      {testimonialModal}

      <Toast message={toast} type={toastType} onClose={() => setToast('')} />

      <AssistantPanel open={assistantOpen} onOpenChange={setAssistantOpen} onDataChanged={fetchProjects} />
      <InstallPrompt />

      {/* Ask sits in the MIDDLE, raised out of the bar, because talking to it is
          now the front door and not a shortcut. It costs no nav slot — the old
          "More" bucket moved onto the Home screen as a hub card, where the
          things in it (insurance, warranty, settings) actually belong. */}
      <div className="bottom-nav">
        {[['home', '🏠', 'Home'], ['jobs', '🔨', 'Jobs']].map(([key, icon, label]) => (
          <button key={key} className={(NAV_BUCKET[activeTab] || 'home') === key ? 'active' : ''} onClick={() => setActiveTab(key)} aria-label={label}>
            <span style={{ fontSize: '20px', lineHeight: '1' }}>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
        <button className="nav-ask" onClick={() => setAssistantOpen(true)} aria-label="Ask JobTally">
          <span className="nav-ask-orb">✨</span>
          <span>Ask</span>
        </button>
        {[['money', '💵', 'Money'], ['crew', '👷', 'Crew']].map(([key, icon, label]) => (
          <button key={key} className={(NAV_BUCKET[activeTab] || 'home') === key ? 'active' : ''} onClick={() => setActiveTab(key)} aria-label={label}>
            <span style={{ fontSize: '20px', lineHeight: '1' }}>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}