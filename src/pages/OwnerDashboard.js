import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { formatCurrency } from '../utils/formatCurrency'
import { formatTime } from '../utils/formatTime'
import { computeProfit, computeMargin, computeContractPrice, roundCents } from '../utils/money'

// Deduction categories an accountant wants broken out at tax time.
const RECEIPT_CATEGORIES = ['materials', 'fuel', 'tools', 'permits', 'subcontractor', 'supplies', 'insurance', 'meals', 'other']
const CATEGORY_LABELS = {
  materials: 'Materials', fuel: 'Fuel / Gas', tools: 'Tools', permits: 'Permits',
  subcontractor: 'Subcontractor', supplies: 'Supplies', insurance: 'Insurance', meals: 'Meals', other: 'Other'
}
const DEFAULT_MILEAGE_RATE = 0.70 // IRS standard business mileage rate — edit per trip to the current year's rate

// Project detail sub-tabs (scrollable on narrow screens).
const PROJECT_TABS = ['receipts', 'time', 'photos', 'changes', 'log', 'mileage', 'schedule', 'budget']
const PROJECT_TAB_LABELS = {
  receipts: 'Receipts', time: 'Time', photos: 'Photos', changes: 'Change Orders',
  log: 'Daily Log', mileage: 'Mileage', schedule: 'Schedule', budget: 'Budget'
}

// Sunday-start week key (YYYY-MM-DD), used to group pay into weekly paychecks.
const dateKey = (d) => {
  const x = new Date(d)
  const pad = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
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
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)', whiteSpace: 'nowrap'
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
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#888' }}>×</button>
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
function JobPhoto({ path, alt, style, onClick }) {
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let active = true
    setUrl(null); setErr(false)
    if (!path) { setErr(true); return }
    if (/^https?:\/\//.test(path)) { setUrl(path); return }
    supabase.storage.from('receipts').createSignedUrl(path, 3600)
      .then(({ data }) => { if (active) { if (data && data.signedUrl) setUrl(data.signedUrl); else setErr(true) } })
      .catch(() => { if (active) setErr(true) })
    return () => { active = false }
  }, [path])
  const base = { background: '#eef1f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }
  if (err) return <div onClick={onClick} style={{ ...base, ...style }}>📷</div>
  if (!url) return <div onClick={onClick} style={{ ...base, ...style }} />
  return <img src={url} alt={alt || 'Job photo'} onClick={onClick} style={style} />
}

export default function OwnerDashboard({ profile }) {
  const [activeTab, setActiveTab] = useState('jobs')
  const [projects, setProjects] = useState([])
  const [workers, setWorkers] = useState([])
  const [workerStats, setWorkerStats] = useState({}) // keyed by worker id
  const [spendByProject, setSpendByProject] = useState({}) // keyed by project id: { materials, labor, other }
  const [selectedProject, setSelectedProject] = useState(null)
  const [projectTab, setProjectTab] = useState('receipts')
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
  const [reportYear, setReportYear] = useState(new Date().getFullYear())
  const [jobForm, setJobForm] = useState({ name: '', client_name: '', client_phone: '', client_email: '', client_address: '', materials_budget: '', labor_budget: '', profit_target: '' })
  const [receiptForm, setReceiptForm] = useState({ description: '', store: '', amount: '', tax: '', category: 'materials', photo_url: '' })
  const [scheduleForm, setScheduleForm] = useState({ worker_id: '', task_description: '', scheduled_date: '', start_time: '', end_time: '' })
  const [mileageEntries, setMileageEntries] = useState([])
  const [showNewMileage, setShowNewMileage] = useState(false)
  const [mileageForm, setMileageForm] = useState({ trip_date: '', miles: '', rate: String(DEFAULT_MILEAGE_RATE), notes: '' })
  const [payroll, setPayroll] = useState([])
  const [paychecks, setPaychecks] = useState([])
  // Getting-paid + field features
  const [coByProject, setCoByProject] = useState({}) // approved change-order $ per project id
  const [dailyLogs, setDailyLogs] = useState([])
  const [changeOrders, setChangeOrders] = useState([])
  const [jobPhotos, setJobPhotos] = useState([])
  const [invoices, setInvoices] = useState([])
  const [showNewLog, setShowNewLog] = useState(false)
  const [showNewChange, setShowNewChange] = useState(false)
  const [showNewInvoice, setShowNewInvoice] = useState(false)
  const [photoLightbox, setPhotoLightbox] = useState(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [logForm, setLogForm] = useState({ log_date: '', weather: '', note: '' })
  const [changeForm, setChangeForm] = useState({ description: '', amount: '', status: 'approved' })
  const [invoiceForm, setInvoiceForm] = useState({ project_id: '', label: '', amount: '', issued_date: '', due_date: '', notes: '' })

  const showToast = (msg, type = 'success') => { setToast(msg); setToastType(type) }

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

  const fetchWorkerStats = useCallback(async (workerList) => {
    if (!workerList?.length) return
    try {
      const workerIds = workerList.map(w => w.id)
      const { data, error } = await supabase
        .from('time_entries')
        .select('worker_id, total_minutes, labor_cost, clocked_in_at')
        .in('worker_id', workerIds)
        .not('clocked_out_at', 'is', null)

      if (error) throw error

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
    } catch (e) {
      console.error('Worker stats fetch failed:', e)
    }
  }, [])

  // Build weekly pay rows (one per worker per week) from clocked-out time, and
  // load any paychecks already recorded so each week shows paid vs. owed.
  const fetchPayroll = useCallback(async () => {
    const workerIds = workers.map(w => w.id)
    if (!workerIds.length) { setPayroll([]); setPaychecks([]); return }
    try {
      const [{ data: times }, { data: checks }] = await Promise.all([
        supabase.from('time_entries').select('worker_id, total_minutes, labor_cost, clocked_in_at').in('worker_id', workerIds).not('clocked_out_at', 'is', null),
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
    if (!projectList?.length) { setSpendByProject({}); setCoByProject({}); return }
    try {
      const ids = projectList.map(p => p.id)
      const [{ data: rcpts }, { data: times }, { data: cos }] = await Promise.all([
        supabase.from('receipts').select('project_id, amount, category').eq('owner_id', profile.id),
        supabase.from('time_entries').select('project_id, labor_cost').in('project_id', ids).not('clocked_out_at', 'is', null),
        supabase.from('change_orders').select('project_id, amount, status').eq('owner_id', profile.id)
      ])
      const spend = {}
      ids.forEach(id => { spend[id] = { materials: 0, labor: 0, other: 0 } })
      ;(rcpts || []).forEach(r => {
        if (!spend[r.project_id]) spend[r.project_id] = { materials: 0, labor: 0, other: 0 }
        if (r.category === 'materials') spend[r.project_id].materials += r.amount || 0
        else spend[r.project_id].other += r.amount || 0
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
    } catch (e) {
      console.error('Spend fetch failed:', e)
    }
  }, [profile.id])

  useEffect(() => {
    Promise.all([fetchProjects(), fetchWorkers()]).finally(() => setInitialLoading(false))
  }, [fetchProjects, fetchWorkers])

  useEffect(() => {
    if (workers.length) fetchWorkerStats(workers)
  }, [workers, fetchWorkerStats])

  useEffect(() => {
    fetchSpend(projects)
  }, [projects, fetchSpend])

  useEffect(() => {
    if (activeTab === 'payroll' && workers.length) fetchPayroll()
  }, [activeTab, workers, fetchPayroll])

  useEffect(() => {
    if (activeTab === 'invoices') fetchInvoices()
  }, [activeTab, fetchInvoices])

  const fetchProjectDetails = async (project) => {
    setSelectedProject(project)
    try {
      const { data: r } = await supabase.from('receipts').select('*').eq('project_id', project.id).order('created_at', { ascending: false })
      setReceipts(r || [])
      const { data: t } = await supabase.from('time_entries').select('*, profiles(full_name)').eq('project_id', project.id).order('clocked_in_at', { ascending: false })
      setTimeEntries(t || [])
      const { data: s } = await supabase.from('schedule_entries').select('*, profiles!schedule_entries_worker_id_fkey(full_name)').eq('project_id', project.id).order('scheduled_date', { ascending: true })
      setScheduleEntries(s || [])
      const { data: m } = await supabase.from('mileage_entries').select('*').eq('project_id', project.id).order('trip_date', { ascending: false })
      setMileageEntries(m || [])
      const { data: lg } = await supabase.from('daily_logs').select('*').eq('project_id', project.id).order('log_date', { ascending: false })
      setDailyLogs(lg || [])
      const { data: cor } = await supabase.from('change_orders').select('*').eq('project_id', project.id).order('created_at', { ascending: false })
      setChangeOrders(cor || [])
      const { data: ph } = await supabase.from('job_photos').select('*').eq('project_id', project.id).order('created_at', { ascending: false })
      setJobPhotos(ph || [])
    } catch (e) {
      showToast('Failed to load job details', 'error')
    }
  }

  const addMileage = async () => {
    if (!mileageForm.miles) return setInlineError('Miles are required')
    setLoading(true)
    setInlineError('')
    try {
      const { error } = await supabase.from('mileage_entries').insert({
        owner_id: profile.id, project_id: selectedProject.id,
        trip_date: mileageForm.trip_date || new Date().toISOString().split('T')[0],
        miles: parseFloat(mileageForm.miles || 0),
        rate: parseFloat(mileageForm.rate || DEFAULT_MILEAGE_RATE),
        notes: mileageForm.notes
      })
      if (error) throw error
      setShowNewMileage(false)
      setMileageForm({ trip_date: '', miles: '', rate: String(DEFAULT_MILEAGE_RATE), notes: '' })
      await fetchProjectDetails(selectedProject)
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
      await fetchProjectDetails(selectedProject)
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
        log_date: logForm.log_date || new Date().toISOString().split('T')[0],
        weather: logForm.weather || null, note: logForm.note
      })
      if (error) throw error
      setShowNewLog(false); setLogForm({ log_date: '', weather: '', note: '' })
      await fetchProjectDetails(selectedProject); showToast('Log saved ✓')
    } catch (e) { setInlineError('Failed to save log. Try again.') }
    setLoading(false)
  }
  const deleteLog = async (entry) => {
    if (!window.confirm('Delete this log entry?')) return
    try {
      const { error } = await supabase.from('daily_logs').delete().eq('id', entry.id)
      if (error) throw error
      await fetchProjectDetails(selectedProject); showToast('Log deleted ✓')
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
      await fetchProjectDetails(selectedProject); await fetchProjects(); showToast('Change order added ✓')
    } catch (e) { setInlineError('Failed to add change order. Try again.') }
    setLoading(false)
  }
  const deleteChangeOrder = async (co) => {
    if (!window.confirm('Delete this change order?')) return
    try {
      const { error } = await supabase.from('change_orders').delete().eq('id', co.id)
      if (error) throw error
      await fetchProjectDetails(selectedProject); await fetchProjects(); showToast('Change order deleted ✓')
    } catch (e) { showToast('Failed to delete change order', 'error') }
  }

  // ---- Job photos (image stored in the private 'receipts' bucket) ----
  const addJobPhoto = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploadingPhoto(true)
    try {
      const fileName = `${profile.id}/jobphotos/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('receipts').upload(fileName, file)
      if (upErr) throw upErr
      const { error } = await supabase.from('job_photos').insert({
        owner_id: profile.id, project_id: selectedProject.id, photo_url: fileName, caption: null
      })
      if (error) throw error
      await fetchProjectDetails(selectedProject); showToast('Photo added ✓')
    } catch (err) { showToast('Photo upload failed', 'error') }
    setUploadingPhoto(false)
  }
  const deleteJobPhoto = async (photo) => {
    if (!window.confirm('Delete this photo?')) return
    try {
      const { error } = await supabase.from('job_photos').delete().eq('id', photo.id)
      if (error) throw error
      setPhotoLightbox(null)
      await fetchProjectDetails(selectedProject); showToast('Photo deleted ✓')
    } catch (e) { showToast('Failed to delete photo', 'error') }
  }

  // ---- Invoices (what the client owes / has paid) ----
  const fetchInvoices = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('invoices')
        .select('*, projects(name, client_name)')
        .eq('owner_id', profile.id)
        .order('issued_date', { ascending: false })
      if (error) throw error
      setInvoices(data || [])
    } catch (e) { console.error('Invoices fetch failed:', e) }
  }, [profile.id])

  const addInvoice = async () => {
    if (!invoiceForm.project_id || !invoiceForm.amount) return setInlineError('Pick a job and enter an amount')
    setLoading(true); setInlineError('')
    try {
      const { error } = await supabase.from('invoices').insert({
        owner_id: profile.id, project_id: invoiceForm.project_id,
        label: invoiceForm.label || 'Invoice', amount: parseFloat(invoiceForm.amount || 0),
        issued_date: invoiceForm.issued_date || new Date().toISOString().split('T')[0],
        due_date: invoiceForm.due_date || null, notes: invoiceForm.notes || null, status: 'unpaid'
      })
      if (error) throw error
      setShowNewInvoice(false); setInvoiceForm({ project_id: '', label: '', amount: '', issued_date: '', due_date: '', notes: '' })
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
          const result = await response.json()
          if (result.store || result.amount) setScanResult(result)
          else setScanError("Couldn't read this receipt — fill in the fields below.")
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
    setReceiptForm(f => ({ ...f, store: scanResult.store, amount: scanResult.amount }))
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
        category: receiptForm.category, photo_url: receiptForm.photo_url || null
      })
      if (error) throw error
      setShowNewReceipt(false)
      setReceiptForm({ description: '', store: '', amount: '', tax: '', category: 'materials', photo_url: '' })
      setScanResult(null); setScanError('')
      await fetchProjectDetails(selectedProject)
      await fetchProjects()
      showToast('Receipt saved ✓')
    } catch (e) {
      setInlineError('Failed to save receipt. Try again.')
    }
    setLoading(false)
  }

  const addSchedule = async () => {
    if (!scheduleForm.worker_id || !scheduleForm.scheduled_date) return setInlineError('Worker and date are required')
    setLoading(true)
    setInlineError('')
    try {
      const { error } = await supabase.from('schedule_entries').insert({
        owner_id: profile.id, worker_id: scheduleForm.worker_id,
        project_id: selectedProject.id, task_description: scheduleForm.task_description,
        scheduled_date: scheduleForm.scheduled_date, start_time: scheduleForm.start_time, end_time: scheduleForm.end_time
      })
      if (error) throw error
      setShowNewSchedule(false)
      setScheduleForm({ worker_id: '', task_description: '', scheduled_date: '', start_time: '', end_time: '' })
      await fetchProjectDetails(selectedProject)
      showToast('Scheduled ✓')
    } catch (e) {
      setInlineError('Failed to save schedule. Try again.')
    }
    setLoading(false)
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
      showToast(`Assigned to ${jobName} ✓`)
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
    } catch (e) {
      showToast('Failed to advance stage', 'error')
    }
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
    a.download = `run-site-${reportYear}-tax-report.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('Report exported ✓')
  }

  const downloadCsv = (rows, filename) => {
    const csv = rows.map(r => r.map(cell => {
      const v = String(cell)
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
    }).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // A full, accountant-ready summary for the year: income from completed jobs,
  // deductible expenses broken out by category, labor, mileage, and sales tax.
  const exportTaxPack = async () => {
    setLoading(true)
    try {
      const yStart = `${reportYear}-01-01`
      const yEndDate = `${reportYear}-12-31`
      const yEndTs = `${yEndDate}T23:59:59`
      const projectIds = projects.map(p => p.id)
      const [{ data: rcpts }, { data: miles }, timesRes] = await Promise.all([
        supabase.from('receipts').select('category, amount, tax_amount, created_at').eq('owner_id', profile.id).gte('created_at', yStart).lte('created_at', yEndTs),
        supabase.from('mileage_entries').select('miles, rate, trip_date').eq('owner_id', profile.id).gte('trip_date', yStart).lte('trip_date', yEndDate),
        projectIds.length
          ? supabase.from('time_entries').select('labor_cost, clocked_in_at').in('project_id', projectIds).not('clocked_out_at', 'is', null).gte('clocked_in_at', yStart).lte('clocked_in_at', yEndTs)
          : Promise.resolve({ data: [] })
      ])
      const r2 = roundCents
      const byCat = {}
      let salesTax = 0
      ;(rcpts || []).forEach(r => {
        byCat[r.category] = (byCat[r.category] || 0) + (r.amount || 0)
        salesTax += r.tax_amount || 0
      })
      const totalMiles = (miles || []).reduce((s, m) => s + (m.miles || 0), 0)
      const mileageDeduction = (miles || []).reduce((s, m) => s + (m.miles || 0) * (m.rate || 0), 0)
      const laborTotal = (timesRes.data || []).reduce((s, t) => s + (t.labor_cost || 0), 0)
      const expensesTotal = Object.values(byCat).reduce((s, v) => s + v, 0)
      const income = reportJobs.reduce((s, p) => s + contractOf(p), 0)
      const deductions = expensesTotal + laborTotal + mileageDeduction

      const rows = []
      rows.push(['RUN-SITE TAX PACK', String(reportYear)])
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

      downloadCsv(rows, `run-site-${reportYear}-tax-pack.csv`)
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
      await fetchProjectDetails(selectedProject)
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
      await fetchProjectDetails(selectedProject)
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
      const updated = {
        name: editJobForm.name, client_name: editJobForm.client_name,
        client_phone: editJobForm.client_phone || null, client_email: editJobForm.client_email || null, client_address: editJobForm.client_address || null,
        materials_budget: materials, labor_budget: labor, profit_target: profit, budget: total
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

  const activeProjects = projects.filter(p => p.stage !== 'end')
  const completedProjects = projects.filter(p => p.stage === 'end')
  const projectedProfit = activeProjects.reduce((sum, p) => sum + profitOf(p), 0)

  const reportYears = [new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2]
  const reportJobs = completedProjects.filter(p => p.completed_at && new Date(p.completed_at).getFullYear() === reportYear)

  // PROJECT DETAIL VIEW
  if (selectedProject) {
    const sp = spendOf(selectedProject.id)
    const matPct = getBudgetPct(sp.materials, selectedProject.materials_budget)
    const labPct = getBudgetPct(sp.labor, selectedProject.labor_budget)
    const projProfit = profitOf(selectedProject)

    return (
      <div>
        <div className="topbar">
          <button onClick={() => setSelectedProject(null)} style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer', padding: '0' }}>←</button>
          <h1 style={{ fontSize: '16px' }}>{selectedProject.name}</h1>
          <span className={'status-pill status-' + selectedProject.stage}>{selectedProject.stage}</span>
        </div>
        {matPct >= 80 && <div className={matPct >= 100 ? 'alert-danger' : 'alert-warning'} style={{ margin: '12px 16px 0' }}>{matPct >= 100 ? '🔴 Materials over budget!' : '⚠️ Materials at ' + Math.round(matPct) + '%'}</div>}
        {labPct >= 80 && <div className={labPct >= 100 ? 'alert-danger' : 'alert-warning'} style={{ margin: '8px 16px 0' }}>{labPct >= 100 ? '🔴 Labor over budget!' : '⚠️ Labor at ' + Math.round(labPct) + '%'}</div>}
        <div className="tabs tabs-scroll" style={{ margin: '16px 16px 0' }}>
          {PROJECT_TABS.map(t => (
            <button key={t} className={'tab ' + (projectTab === t ? 'active' : '')} onClick={() => setProjectTab(t)}>{PROJECT_TAB_LABELS[t]}</button>
          ))}
        </div>
        <div className="page">
          {projectTab === 'budget' && (
            <div>
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
                  <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>CONTRACT + CHANGE ORDERS</p>
                  <p style={{ fontSize: '13px', color: '#4B5563' }}>Base contract <span style={{ float: 'right', fontWeight: '600' }}>{formatCurrency(selectedProject.budget)}</span></p>
                  <p style={{ fontSize: '13px', color: '#16A34A', marginTop: '4px' }}>Approved change orders <span style={{ float: 'right', fontWeight: '600' }}>+{formatCurrency(coOf(selectedProject.id))}</span></p>
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
          <p style={{ fontWeight: '700', color: '#DC2626', fontSize: '14px' }}>{formatCurrency(w.cost)}</p>
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
              <div className="card">
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>PROFIT TARGET</p>
                <p style={{ fontWeight: '700', fontSize: '22px', color: '#16A34A' }}>{formatCurrency(selectedProject.profit_target)}</p>
              </div>
              <div className="card">
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>PROJECTED PROFIT</p>
                <p style={{ fontWeight: '700', fontSize: '22px', color: projProfit >= 0 ? '#16A34A' : '#DC2626' }}>{formatCurrency(projProfit)}</p>
                {projProfit < 0 && <p style={{ fontSize: '12px', color: '#DC2626', marginTop: '4px' }}>⚠️ Projected to go over budget</p>}
              </div>
              {selectedProject.stage !== 'end' && (
                <button className="btn-secondary" onClick={() => advanceStage(selectedProject)}>
                  {selectedProject.stage === 'start' ? 'Advance to Mid →' : 'Mark as Complete ✓'}
                </button>
              )}
              <button className="btn-secondary" onClick={openEditJob}>✎ Edit Job Details</button>
              {selectedProject.stage === 'end' && (
                <button className="btn-secondary" onClick={() => reopenJob(selectedProject)}>↩ Reopen Job</button>
              )}
            </div>
          )}

          {projectTab === 'receipts' && (
            <div>
              <button className="btn-primary" onClick={() => { setShowNewReceipt(true); setInlineError('') }}>+ Add Receipt</button>
              {receipts.map(r => (
                <div key={r.id} className="card" onClick={() => setPhotoViewer(r)} style={{ cursor: r.photo_url ? 'pointer' : 'default' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3>{r.description}</h3>
                      <p>{r.store} · {CATEGORY_LABELS[r.category] || r.category}{r.tax_amount > 0 ? ` · tax ${formatCurrency(r.tax_amount)}` : ''}</p>
                      <p style={{ fontSize: '11px', color: '#717171' }}>{new Date(r.created_at).toLocaleDateString()}</p>
                      {r.photo_url && <p style={{ fontSize: '11px', color: '#E07B2A', marginTop: '2px' }}>📷 Tap to view photo</p>}
                    </div>
                    <p style={{ fontWeight: '700', color: '#DC2626', fontSize: '16px' }}>{formatCurrency(r.amount)}</p>
                  </div>
                </div>
              ))}
              {receipts.length === 0 && <div className="empty-state"><p>No receipts yet</p></div>}
            </div>
          )}

          {projectTab === 'time' && (
            <div>
              {timeEntries.map(t => (
                <div key={t.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <h3>{t.profiles ? t.profiles.full_name : 'Worker'}</h3>
                      <p>{new Date(t.clocked_in_at).toLocaleDateString()}</p>
                      <p>{t.total_minutes ? formatTime(t.total_minutes) : 'Still clocked in'}</p>
                      {t.gps_lat != null && t.gps_lng != null && (
                        <a
                          href={`https://www.google.com/maps?q=${t.gps_lat},${t.gps_lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: '12px', color: '#E07B2A', textDecoration: 'none', marginTop: '4px', display: 'inline-block' }}
                        >
                          📍 Clock-in location
                        </a>
                      )}
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
              {timeEntries.length === 0 && <div className="empty-state"><p>No time entries yet</p></div>}
            </div>
          )}

          {projectTab === 'mileage' && (
            <div>
              <button className="btn-primary" onClick={() => { setShowNewMileage(true); setInlineError('') }}>+ Add Mileage</button>
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
                      <h3>{(m.miles || 0).toLocaleString()} mi <span style={{ fontWeight: '400', color: '#888', fontSize: '13px' }}>@ ${m.rate}/mi</span></h3>
                      <p style={{ fontSize: '12px', color: '#717171' }}>{m.trip_date ? new Date(m.trip_date + 'T00:00:00').toLocaleDateString() : ''}{m.notes ? ` · ${m.notes}` : ''}</p>
                    </div>
                    <p style={{ fontWeight: '700', color: '#16A34A', fontSize: '16px' }}>{formatCurrency((m.miles || 0) * (m.rate || 0))}</p>
                  </div>
                  <button onClick={() => deleteMileage(m)} style={{ marginTop: '10px', background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '8px 14px', borderRadius: '8px', minHeight: '40px' }}>Delete</button>
                </div>
              ))}
              {mileageEntries.length === 0 && <div className="empty-state"><p>No mileage logged yet. Track miles driven for this job — it's a deduction.</p></div>}
            </div>
          )}

          {projectTab === 'photos' && (
            <div>
              <label className="btn-primary" style={{ display: 'block', textAlign: 'center', cursor: 'pointer' }}>
                {uploadingPhoto ? 'Uploading…' : '📷 Add Photo'}
                <input type="file" accept="image/*" capture="environment" onChange={addJobPhoto} disabled={uploadingPhoto} style={{ display: 'none' }} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '12px' }}>
                {jobPhotos.map(ph => (
                  <JobPhoto key={ph.id} path={ph.photo_url} alt={ph.caption} onClick={() => setPhotoLightbox(ph)}
                    style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: '10px', cursor: 'pointer' }} />
                ))}
              </div>
              {jobPhotos.length === 0 && <div className="empty-state"><p>No photos yet. Snap before/after shots — great for clients and your portfolio.</p></div>}
            </div>
          )}

          {projectTab === 'changes' && (
            <div>
              <button className="btn-primary" onClick={() => { setShowNewChange(true); setInlineError('') }}>+ Add Change Order</button>
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
              {changeOrders.length === 0 && <div className="empty-state"><p>No change orders yet. Log extra work the client approves so you get paid for it.</p></div>}
            </div>
          )}

          {projectTab === 'log' && (
            <div>
              <button className="btn-primary" onClick={() => { setShowNewLog(true); setInlineError('') }}>+ Add Log Entry</button>
              {dailyLogs.map(l => (
                <div key={l.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p className="schedule-day" style={{ margin: 0 }}>{l.log_date ? new Date(l.log_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}</p>
                    {l.weather && <span style={{ fontSize: '12px', color: '#E07B2A', fontWeight: '600' }}>{l.weather}</span>}
                  </div>
                  <p style={{ marginTop: '6px', whiteSpace: 'pre-wrap' }}>{l.note}</p>
                  <button onClick={() => deleteLog(l)} style={{ marginTop: '10px', background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '8px 14px', borderRadius: '8px', minHeight: '40px' }}>Delete</button>
                </div>
              ))}
              {dailyLogs.length === 0 && <div className="empty-state"><p>No log entries yet. Jot down what happened on site — handy for memory and disputes.</p></div>}
            </div>
          )}

          {projectTab === 'schedule' && (
            <div>
              <button className="btn-primary" onClick={() => { setShowNewSchedule(true); setInlineError('') }}>+ Schedule Worker</button>
              {scheduleEntries.map(s => (
                <div key={s.id} className="card">
                  <p className="schedule-day">{new Date(s.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                  <h3>{s.profiles ? s.profiles.full_name : 'Worker'}</h3>
                  <p>{s.task_description}</p>
                  {s.start_time && <p style={{ fontSize: '12px', color: '#E07B2A', marginTop: '4px', fontWeight: '600' }}>{s.start_time} — {s.end_time}</p>}
                </div>
              ))}
              {scheduleEntries.length === 0 && <div className="empty-state"><p>No schedule yet</p></div>}
            </div>
          )}
        </div>

        {showNewReceipt && (
          <div className="modal-overlay" onClick={() => { setShowNewReceipt(false); setScanResult(null); setScanError('') }}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Add Receipt</h2>
              <div className="input-group">
                <label>📷 Scan Receipt Photo</label>
                <input type="file" accept="image/*" capture="environment" onChange={scanReceipt} style={{ padding: '8px 0' }} />
                {scanning && <p style={{ color: '#E07B2A', fontSize: '13px', marginTop: '6px' }}>🔍 Scanning receipt...</p>}
                {scanError && <p style={{ color: '#DC2626', fontSize: '13px', marginTop: '6px' }}>{scanError}</p>}
              </div>
              {scanResult && (
                <div style={{ background: '#f0fdf4', border: '1px solid #16A34A', borderRadius: '10px', padding: '14px', marginBottom: '14px' }}>
                  <p style={{ fontSize: '12px', color: '#16A34A', fontWeight: '600', marginBottom: '8px' }}>📷 Scanned — confirm before saving</p>
                  <p style={{ fontSize: '15px', fontWeight: '600' }}>Store: {scanResult.store}</p>
                  <p style={{ fontSize: '15px', fontWeight: '600' }}>Amount: ${scanResult.amount}</p>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <button onClick={confirmScan} style={{ flex: 1, background: '#16A34A', color: 'white', border: 'none', borderRadius: '8px', padding: '10px', fontWeight: '600', cursor: 'pointer' }}>Looks right ✓</button>
                    <button onClick={() => setScanResult(null)} style={{ flex: 1, background: 'transparent', color: '#16A34A', border: '2px solid #16A34A', borderRadius: '8px', padding: '10px', fontWeight: '600', cursor: 'pointer' }}>Edit manually</button>
                  </div>
                </div>
              )}
              <div className="input-group"><label>Description</label><input value={receiptForm.description} onChange={e => setReceiptForm({ ...receiptForm, description: e.target.value })} placeholder="Concrete mix" /></div>
              <div className="input-group"><label>Store</label><input value={receiptForm.store} onChange={e => setReceiptForm({ ...receiptForm, store: e.target.value })} placeholder="Home Depot" /></div>
              <div className="input-group"><label>Amount ($)</label><input type="number" value={receiptForm.amount} onChange={e => setReceiptForm({ ...receiptForm, amount: e.target.value })} placeholder="0.00" /></div>
              <div className="input-group"><label>Sales Tax ($) <span style={{ color: '#888', fontWeight: '400' }}>— optional</span></label><input type="number" value={receiptForm.tax} onChange={e => setReceiptForm({ ...receiptForm, tax: e.target.value })} placeholder="0.00" /></div>
              <div className="input-group"><label>Category</label><select value={receiptForm.category} onChange={e => setReceiptForm({ ...receiptForm, category: e.target.value })}>{RECEIPT_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></div>
              {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
              <button className="btn-primary" onClick={addReceipt} disabled={loading || !receiptForm.amount}>{loading ? 'Saving...' : 'Save Receipt'}</button>
              <button className="btn-secondary" onClick={() => { setShowNewReceipt(false); setScanResult(null); setScanError(''); setInlineError('') }}>Cancel</button>
            </div>
          </div>
        )}

        {showNewSchedule && (
          <div className="modal-overlay" onClick={() => setShowNewSchedule(false)}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Schedule Worker</h2>
              <div className="input-group"><label>Worker</label><select value={scheduleForm.worker_id} onChange={e => setScheduleForm({ ...scheduleForm, worker_id: e.target.value })}><option value="">Select worker</option>{workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}</select></div>
              <div className="input-group"><label>Task</label><input value={scheduleForm.task_description} onChange={e => setScheduleForm({ ...scheduleForm, task_description: e.target.value })} placeholder="Pour foundation" /></div>
              <div className="input-group"><label>Date</label><input type="date" value={scheduleForm.scheduled_date} onChange={e => setScheduleForm({ ...scheduleForm, scheduled_date: e.target.value })} /></div>
              <div className="input-group"><label>Start Time</label><input type="time" value={scheduleForm.start_time} onChange={e => setScheduleForm({ ...scheduleForm, start_time: e.target.value })} /></div>
              <div className="input-group"><label>End Time</label><input type="time" value={scheduleForm.end_time} onChange={e => setScheduleForm({ ...scheduleForm, end_time: e.target.value })} /></div>
              {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
              <button className="btn-primary" onClick={addSchedule} disabled={loading}>{loading ? 'Saving...' : 'Schedule'}</button>
              <button className="btn-secondary" onClick={() => { setShowNewSchedule(false); setInlineError('') }}>Cancel</button>
            </div>
          </div>
        )}

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
              <button className="btn-primary" onClick={addMileage} disabled={loading}>{loading ? 'Saving...' : 'Add Mileage'}</button>
              <button className="btn-secondary" onClick={() => { setShowNewMileage(false); setInlineError('') }}>Cancel</button>
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
              <button className="btn-primary" onClick={saveEditJob} disabled={loading}>{loading ? 'Saving...' : 'Save Changes'}</button>
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
              <button className="btn-primary" onClick={addLog} disabled={loading}>{loading ? 'Saving...' : 'Save Log'}</button>
              <button className="btn-secondary" onClick={() => { setShowNewLog(false); setInlineError('') }}>Cancel</button>
            </div>
          </div>
        )}

        {showNewChange && (
          <div className="modal-overlay" onClick={() => { setShowNewChange(false); setInlineError('') }}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Add Change Order</h2>
              <div className="input-group"><label>What's the change?</label><input value={changeForm.description} onChange={e => setChangeForm({ ...changeForm, description: e.target.value })} placeholder="Add tile backsplash" /></div>
              <div className="input-group"><label>Price ($)</label><input type="number" value={changeForm.amount} onChange={e => setChangeForm({ ...changeForm, amount: e.target.value })} placeholder="850" /></div>
              <div className="input-group"><label>Status</label><select value={changeForm.status} onChange={e => setChangeForm({ ...changeForm, status: e.target.value })}><option value="approved">Approved</option><option value="pending">Pending</option><option value="declined">Declined</option></select></div>
              <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>Approved change orders add to what the client owes and to your projected profit.</p>
              {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
              <button className="btn-primary" onClick={addChangeOrder} disabled={loading}>{loading ? 'Saving...' : 'Add Change Order'}</button>
              <button className="btn-secondary" onClick={() => { setShowNewChange(false); setInlineError('') }}>Cancel</button>
            </div>
          </div>
        )}

        {photoLightbox && (
          <div className="modal-overlay" onClick={() => setPhotoLightbox(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '20px 20px 0 0', padding: '20px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: '700' }}>{photoLightbox.caption || 'Job photo'}</h2>
                <button onClick={() => setPhotoLightbox(null)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#888' }}>×</button>
              </div>
              <JobPhoto path={photoLightbox.photo_url} alt={photoLightbox.caption} style={{ width: '100%', borderRadius: '12px', objectFit: 'contain', maxHeight: '60vh', background: '#eef1f5' }} />
              <p style={{ fontSize: '12px', color: '#717171', marginTop: '10px' }}>{photoLightbox.created_at ? new Date(photoLightbox.created_at).toLocaleDateString() : ''}</p>
              <button onClick={() => deleteJobPhoto(photoLightbox)} style={{ marginTop: '16px', width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #DC2626', background: 'white', color: '#DC2626', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>Delete photo</button>
            </div>
          </div>
        )}

        {photoViewer && <PhotoViewer receipt={photoViewer} onClose={() => setPhotoViewer(null)} onDelete={deleteReceipt} />}
        <Toast message={toast} type={toastType} onClose={() => setToast('')} />
      </div>
    )
  }

  // MAIN DASHBOARD
  return (
    <div>
      <div className="topbar"><h1>RUN-SITE</h1><button onClick={() => supabase.auth.signOut()}>Sign Out</button></div>
      <div className="tabs tabs-scroll" style={{ margin: '16px 16px 0' }}>
        {['jobs', 'workers', 'payroll', 'invoices', 'reports'].map(t => (
          <button key={t} className={'tab ' + (activeTab === t ? 'active' : '')} onClick={() => setActiveTab(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      <div className="page">

        {activeTab === 'jobs' && (
          <div>
            <div className="stats-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="stat-card"><div className="stat-value">{activeProjects.length}</div><div className="stat-label">Active Jobs</div></div>
              <div className="stat-card"><div className="stat-value">{completedProjects.length}</div><div className="stat-label">Completed</div></div>
              <div className="stat-card"><div className="stat-value" style={{ fontSize: '16px', color: projectedProfit >= 0 ? '#16A34A' : '#DC2626' }}>{formatCurrency(projectedProfit)}</div><div className="stat-label">Proj. Profit</div></div>
            </div>
            <button className="btn-primary" onClick={() => { setShowNewJob(true); setInlineError('') }}>+ New Job</button>

            {activeProjects.length > 0 && (
              <div>
                <p style={{ fontSize: '11px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '1px', margin: '16px 0 8px', padding: '0 4px' }}>Active</p>
                {activeProjects.map(p => {
                  const s = spendOf(p.id)
                  const matPct = getBudgetPct(s.materials, p.materials_budget)
                  const labPct = getBudgetPct(s.labor, p.labor_budget)
                  return (
                    <div key={p.id} className="card" onClick={() => fetchProjectDetails(p)} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div><h3>{p.name}</h3><p>{p.client_name}</p></div>
                        <span className={'status-pill status-' + p.stage}>{p.stage}</span>
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
                  <div key={p.id} className="card" onClick={() => fetchProjectDetails(p)} style={{ cursor: 'pointer', background: '#f9fafb' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <h3 style={{ color: '#666' }}>{p.name}</h3>
                        <p>{p.client_name}</p>
                        {p.completed_at && <p style={{ fontSize: '11px', color: '#717171', marginTop: '2px' }}>Completed {new Date(p.completed_at).toLocaleDateString()}</p>}
                      </div>
                      <span className="status-pill status-end">✓ Done</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {initialLoading && projects.length === 0 && <div className="empty-state"><p>Loading…</p></div>}
            {!initialLoading && projects.length === 0 && <div className="empty-state"><p>No jobs yet. Create your first job!</p></div>}
          </div>
        )}

        {activeTab === 'workers' && (
          <div>
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 4px' }}>
              Workers sign up at the app and enter your email to link to your account.
            </p>
            {workers.map(w => {
              const stats = workerStats[w.id]
              return (
                <div key={w.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <h3>{w.full_name}</h3>
                      <p>{w.email}</p>
                      <p style={{ color: '#E07B2A', fontWeight: '600', marginTop: '4px' }}>${w.hourly_rate || 0}/hr</p>
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
                      <button onClick={() => { setShowEditRate(w); setEditRate(w.hourly_rate || ''); setInlineError('') }} style={{ background: '#E07B2A', color: 'white', border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}>Edit Rate</button>
                      <button onClick={() => { setShowAssignWorker(w); setAssignProjectId(''); setInlineError('') }} style={{ background: '#1C2B3A', color: 'white', border: 'none', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}>Assign</button>
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
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px', padding: '0 4px' }}>
              Weekly pay per worker, straight from their clocked hours. Tap "Mark Paid" each week to record a paycheck.
            </p>
            {workers.length === 0 && <div className="empty-state"><p>Add workers first — their clocked hours become weekly paychecks here.</p></div>}
            {workers.map(w => {
              const rows = payroll.filter(r => r.worker_id === w.id)
              const unpaidTotal = rows.reduce((s, r) => {
                const paid = paychecks.find(c => c.worker_id === r.worker_id && c.week_start === r.week_start)
                return s + (paid ? 0 : r.gross)
              }, 0)
              return (
                <div key={w.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: rows.length ? '8px' : '0' }}>
                    <div><h3>{w.full_name}</h3><p>${w.hourly_rate || 0}/hr</p></div>
                    {unpaidTotal > 0 && <div style={{ textAlign: 'right' }}><p style={{ fontSize: '11px', color: '#888' }}>Owed</p><p style={{ fontWeight: '700', color: '#DC2626', fontSize: '16px' }}>{formatCurrency(unpaidTotal)}</p></div>}
                  </div>
                  {rows.length === 0 && <p style={{ fontSize: '13px', color: '#888' }}>No hours clocked yet.</p>}
                  {rows.map(r => {
                    const paid = paychecks.find(c => c.worker_id === r.worker_id && c.week_start === r.week_start)
                    return (
                      <div key={r.week_start} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid #f0f0f0' }}>
                        <div>
                          <p style={{ fontWeight: '600', fontSize: '14px' }}>Week of {new Date(r.week_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                          <p style={{ fontSize: '12px', color: '#717171' }}>{formatTime(r.minutes)} · {formatCurrency(r.gross)}</p>
                        </div>
                        {paid
                          ? <span style={{ fontSize: '12px', fontWeight: '700', color: '#16A34A' }}>Paid ✓</span>
                          : <button onClick={() => recordPaycheck(r)} disabled={loading} style={{ background: '#16A34A', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', minHeight: '40px' }}>Mark Paid</button>
                        }
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'invoices' && (
          <div>
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
                  <button className="btn-primary" onClick={() => { setShowNewInvoice(true); setInlineError('') }}>+ New Invoice</button>
                  {unpaid.length > 0 && <p style={{ fontSize: '11px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '1px', margin: '16px 0 8px', padding: '0 4px' }}>Owed to you</p>}
                  {unpaid.map(inv => (
                    <div key={inv.id} className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, paddingRight: '10px' }}>
                          <h3>{inv.label} · {formatCurrency(inv.amount)}</h3>
                          <p>{inv.projects ? inv.projects.name : ''}{inv.projects && inv.projects.client_name ? ` · ${inv.projects.client_name}` : ''}</p>
                          <p style={{ fontSize: '11px', color: '#717171' }}>{inv.due_date ? `Due ${new Date(inv.due_date + 'T00:00:00').toLocaleDateString()}` : (inv.issued_date ? `Sent ${new Date(inv.issued_date + 'T00:00:00').toLocaleDateString()}` : '')}</p>
                        </div>
                        <button onClick={() => markInvoicePaid(inv)} disabled={loading} style={{ background: '#16A34A', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', minHeight: '40px' }}>Mark Paid</button>
                      </div>
                      <button onClick={() => deleteInvoice(inv)} style={{ marginTop: '10px', background: 'none', border: '1px solid #FCA5A5', color: '#DC2626', fontSize: '12px', fontWeight: '600', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px' }}>Delete</button>
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
                  {invoices.length === 0 && <div className="empty-state"><p>No invoices yet. Create one to bill a client and track what you're owed.</p></div>}
                </>
              )
            })()}
          </div>
        )}

        {activeTab === 'reports' && (
          <div>
            <div className="input-group">
              <label>Year</label>
              <select value={reportYear} onChange={e => setReportYear(parseInt(e.target.value))}>
                {reportYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
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
            <button className="btn-primary" onClick={saveWorkerRate} disabled={loading}>{loading ? 'Saving...' : 'Save'}</button>
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
            <button className="btn-primary" onClick={() => assignWorkerToProject(showAssignWorker.id)} disabled={loading}>{loading ? 'Assigning...' : 'Assign'}</button>
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
            {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
            <button className="btn-primary" onClick={createJob} disabled={loading}>{loading ? 'Creating...' : 'Create Job'}</button>
            <button className="btn-secondary" onClick={() => { setShowNewJob(false); setInlineError('') }}>Cancel</button>
          </div>
        </div>
      )}

      {showNewInvoice && (
        <div className="modal-overlay" onClick={() => { setShowNewInvoice(false); setInlineError('') }}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>New Invoice</h2>
            <div className="input-group"><label>Job</label><select value={invoiceForm.project_id} onChange={e => setInvoiceForm({ ...invoiceForm, project_id: e.target.value })}><option value="">-- Choose a job --</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="input-group"><label>Label</label><input value={invoiceForm.label} onChange={e => setInvoiceForm({ ...invoiceForm, label: e.target.value })} placeholder="Deposit / Progress / Final" /></div>
            <div className="input-group"><label>Amount ($)</label><input type="number" value={invoiceForm.amount} onChange={e => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} placeholder="2500" /></div>
            <div className="input-group"><label>Issued Date</label><input type="date" value={invoiceForm.issued_date} onChange={e => setInvoiceForm({ ...invoiceForm, issued_date: e.target.value })} /></div>
            <div className="input-group"><label>Due Date</label><input type="date" value={invoiceForm.due_date} onChange={e => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} /></div>
            <div className="input-group"><label>Notes (optional)</label><input value={invoiceForm.notes} onChange={e => setInvoiceForm({ ...invoiceForm, notes: e.target.value })} placeholder="50% deposit to start" /></div>
            {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
            <button className="btn-primary" onClick={addInvoice} disabled={loading}>{loading ? 'Creating...' : 'Create Invoice'}</button>
            <button className="btn-secondary" onClick={() => { setShowNewInvoice(false); setInlineError('') }}>Cancel</button>
          </div>
        </div>
      )}

      <Toast message={toast} type={toastType} onClose={() => setToast('')} />
    </div>
  )
}