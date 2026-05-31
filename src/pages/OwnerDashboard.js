import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { formatCurrency } from '../utils/formatCurrency'
import { formatTime } from '../utils/formatTime'
import { computeProfit, computeMargin, computeContractPrice, roundCents } from '../utils/money'

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
  const [editJobForm, setEditJobForm] = useState({ name: '', client_name: '', materials_budget: '', labor_budget: '', profit_target: '' })
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
  const [jobForm, setJobForm] = useState({ name: '', client_name: '', materials_budget: '', labor_budget: '', profit_target: '' })
  const [receiptForm, setReceiptForm] = useState({ description: '', store: '', amount: '', category: 'materials', photo_url: '' })
  const [scheduleForm, setScheduleForm] = useState({ worker_id: '', task_description: '', scheduled_date: '', start_time: '', end_time: '' })

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

  // Compute each job's spending LIVE from the source records (receipts +
  // clocked-out time entries) instead of trusting denormalized running-total
  // columns. This keeps profit accurate, counts every receipt category, and
  // means editing/deleting a record self-corrects the totals automatically.
  const fetchSpend = useCallback(async (projectList) => {
    if (!projectList?.length) { setSpendByProject({}); return }
    try {
      const ids = projectList.map(p => p.id)
      const [{ data: rcpts }, { data: times }] = await Promise.all([
        supabase.from('receipts').select('project_id, amount, category').eq('owner_id', profile.id),
        supabase.from('time_entries').select('project_id, labor_cost').in('project_id', ids).not('clocked_out_at', 'is', null)
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
      setSpendByProject(spend)
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

  const fetchProjectDetails = async (project) => {
    setSelectedProject(project)
    try {
      const { data: r } = await supabase.from('receipts').select('*').eq('project_id', project.id).order('created_at', { ascending: false })
      setReceipts(r || [])
      const { data: t } = await supabase.from('time_entries').select('*, profiles(full_name)').eq('project_id', project.id).order('clocked_in_at', { ascending: false })
      setTimeEntries(t || [])
      const { data: s } = await supabase.from('schedule_entries').select('*, profiles(full_name)').eq('project_id', project.id).order('scheduled_date', { ascending: true })
      setScheduleEntries(s || [])
    } catch (e) {
      showToast('Failed to load job details', 'error')
    }
  }

  const createJob = async () => {
    if (!jobForm.name) return setInlineError('Job name is required')
    setLoading(true)
    setInlineError('')
    try {
      const total = computeContractPrice(jobForm.materials_budget, jobForm.labor_budget, jobForm.profit_target)
      const { error } = await supabase.from('projects').insert({
        owner_id: profile.id, name: jobForm.name, client_name: jobForm.client_name,
        budget: total, materials_budget: parseFloat(jobForm.materials_budget || 0),
        labor_budget: parseFloat(jobForm.labor_budget || 0), profit_target: parseFloat(jobForm.profit_target || 0),
        stage: 'start'
      })
      if (error) throw error
      setShowNewJob(false)
      setJobForm({ name: '', client_name: '', materials_budget: '', labor_budget: '', profit_target: '' })
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
        amount, category: receiptForm.category, photo_url: receiptForm.photo_url || null
      })
      if (error) throw error
      setShowNewReceipt(false)
      setReceiptForm({ description: '', store: '', amount: '', category: 'materials', photo_url: '' })
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
      const rev = r2(p.budget), mat = r2(s.materials), lab = r2(s.labor), oth = r2(s.other)
      const profit = r2(profitOf(p))
      const margin = computeMargin(profit, p.budget)
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
  // Profit = contract price (budget) minus everything actually spent.
  const profitOf = (p) => computeProfit(p.budget, spendOf(p.id))

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
        <div className="tabs" style={{ margin: '16px 16px 0' }}>
          {['receipts', 'time', 'budget', 'schedule'].map(t => (
            <button key={t} className={'tab ' + (projectTab === t ? 'active' : '')} onClick={() => setProjectTab(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
        <div className="page">
          {projectTab === 'budget' && (
            <div>
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
                      <p>{r.store} · {r.category}</p>
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
              <div className="input-group"><label>Category</label><select value={receiptForm.category} onChange={e => setReceiptForm({ ...receiptForm, category: e.target.value })}><option value="materials">Materials</option><option value="other">Other</option></select></div>
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

        {showEditJob && (
          <div className="modal-overlay" onClick={() => { setShowEditJob(false); setInlineError('') }}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Edit Job</h2>
              <div className="input-group"><label>Job Name</label><input value={editJobForm.name} onChange={e => setEditJobForm({ ...editJobForm, name: e.target.value })} placeholder="Kitchen remodel" /></div>
              <div className="input-group"><label>Client</label><input value={editJobForm.client_name} onChange={e => setEditJobForm({ ...editJobForm, client_name: e.target.value })} placeholder="Client name" /></div>
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

        {photoViewer && <PhotoViewer receipt={photoViewer} onClose={() => setPhotoViewer(null)} onDelete={deleteReceipt} />}
        <Toast message={toast} type={toastType} onClose={() => setToast('')} />
      </div>
    )
  }

  // MAIN DASHBOARD
  return (
    <div>
      <div className="topbar"><h1>RUN-SITE</h1><button onClick={() => supabase.auth.signOut()}>Sign Out</button></div>
      <div className="tabs" style={{ margin: '16px 16px 0' }}>
        {['jobs', 'workers', 'reports'].map(t => (
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
                <button className="btn-secondary" onClick={exportReportCSV} style={{ marginBottom: '12px' }}>⬇ Export {reportYear} for Taxes (CSV)</button>
                <div className="card" style={{ background: '#1C2B3A', color: 'white' }}>
                  <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>{reportYear} Summary</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div><p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Jobs Completed</p><p style={{ fontSize: '20px', fontWeight: '700' }}>{reportJobs.length}</p></div>
                    <div><p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Total Revenue</p><p style={{ fontSize: '20px', fontWeight: '700' }}>{formatCurrency(reportJobs.reduce((s, p) => s + (p.budget || 0), 0))}</p></div>
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
                  const margin = computeMargin(profit, p.budget)
                  return (
                    <div key={p.id} className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                        <div><h3>{p.name}</h3><p>{p.client_name}</p></div>
                        <span style={{ fontSize: '14px', fontWeight: '700', color: profit >= 0 ? '#16A34A' : '#DC2626' }}>{margin}%</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '13px' }}>
                        <div><span style={{ color: '#888' }}>Revenue</span><p style={{ fontWeight: '600' }}>{formatCurrency(p.budget)}</p></div>
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
            <div className="input-group"><label>Materials Budget ($)</label><input type="number" value={jobForm.materials_budget} onChange={e => setJobForm({ ...jobForm, materials_budget: e.target.value })} placeholder="3000" /></div>
            <div className="input-group"><label>Labor Budget ($)</label><input type="number" value={jobForm.labor_budget} onChange={e => setJobForm({ ...jobForm, labor_budget: e.target.value })} placeholder="1000" /></div>
            <div className="input-group"><label>Profit Target ($)</label><input type="number" value={jobForm.profit_target} onChange={e => setJobForm({ ...jobForm, profit_target: e.target.value })} placeholder="1000" /></div>
            {inlineError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{inlineError}</p>}
            <button className="btn-primary" onClick={createJob} disabled={loading}>{loading ? 'Creating...' : 'Create Job'}</button>
            <button className="btn-secondary" onClick={() => { setShowNewJob(false); setInlineError('') }}>Cancel</button>
          </div>
        </div>
      )}

      <Toast message={toast} type={toastType} onClose={() => setToast('')} />
    </div>
  )
}