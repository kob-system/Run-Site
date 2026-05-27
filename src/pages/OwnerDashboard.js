import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { formatCurrency } from '../utils/formatCurrency'
import { formatTime } from '../utils/formatTime'

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

function PhotoViewer({ receipt, onClose }) {
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
          ? <img src={receipt.photo_url} alt="Receipt" style={{ width: '100%', borderRadius: '12px', objectFit: 'contain', maxHeight: '400px' }} />
          : <div style={{ background: '#f4f6f9', borderRadius: '12px', height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>No photo saved</div>
        }
        <div style={{ marginTop: '16px' }}>
          <p style={{ fontSize: '14px', color: '#666' }}>{receipt.store} · {receipt.category}</p>
          <p style={{ fontSize: '22px', fontWeight: '700', color: '#DC2626', marginTop: '8px' }}>{formatCurrency(receipt.amount)}</p>
          <p style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>{new Date(receipt.created_at).toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  )
}

export default function OwnerDashboard({ profile }) {
  const [activeTab, setActiveTab] = useState('jobs')
  const [projects, setProjects] = useState([])
  const [workers, setWorkers] = useState([])
  const [workerStats, setWorkerStats] = useState({}) // keyed by worker id
  const [selectedProject, setSelectedProject] = useState(null)
  const [projectTab, setProjectTab] = useState('receipts')
  const [receipts, setReceipts] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [scheduleEntries, setScheduleEntries] = useState([])
  const [showNewJob, setShowNewJob] = useState(false)
  const [showNewReceipt, setShowNewReceipt] = useState(false)
  const [showNewSchedule, setShowNewSchedule] = useState(false)
  const [showAssignWorker, setShowAssignWorker] = useState(null)
  const [showEditRate, setShowEditRate] = useState(null)
  const [assignProjectId, setAssignProjectId] = useState('')
  const [editRate, setEditRate] = useState('')
  const [loading, setLoading] = useState(false)
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

  useEffect(() => {
    fetchProjects()
    fetchWorkers()
  }, [fetchProjects, fetchWorkers])

  useEffect(() => {
    if (workers.length) fetchWorkerStats(workers)
  }, [workers, fetchWorkerStats])

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
      const total = parseFloat(jobForm.materials_budget || 0) + parseFloat(jobForm.labor_budget || 0) + parseFloat(jobForm.profit_target || 0)
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
      const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(fileName)
      setReceiptForm(f => ({ ...f, photo_url: urlData.publicUrl }))

      const reader = new FileReader()
      reader.onload = async (event) => {
        const base64 = event.target.result.split(',')[1]
        try {
          const response = await fetch('/api/scan-receipt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
      if (receiptForm.category === 'materials') {
        const { data: p } = await supabase.from('projects').select('materials_spent').eq('id', selectedProject.id).single()
        await supabase.from('projects').update({ materials_spent: (p?.materials_spent || 0) + amount }).eq('id', selectedProject.id)
      }
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

  const getBudgetPct = (spent, budget) => budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
  const getBudgetClass = (pct) => pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : ''

  const activeProjects = projects.filter(p => p.stage !== 'end')
  const completedProjects = projects.filter(p => p.stage === 'end')
  const projectedProfit = activeProjects.reduce((sum, p) => {
    if (!p.materials_budget && !p.labor_budget) return sum
    return sum + (p.profit_target || 0) - (p.materials_spent || 0) - (p.labor_spent || 0)
  }, 0)

  const reportYears = [new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2]
  const reportJobs = completedProjects.filter(p => p.completed_at && new Date(p.completed_at).getFullYear() === reportYear)

  // PROJECT DETAIL VIEW
  if (selectedProject) {
    const matPct = getBudgetPct(selectedProject.materials_spent, selectedProject.materials_budget)
    const labPct = getBudgetPct(selectedProject.labor_spent, selectedProject.labor_budget)
    const projProfit = (selectedProject.profit_target || 0) - (selectedProject.materials_spent || 0) - (selectedProject.labor_spent || 0)

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
                <p style={{ fontWeight: '700', fontSize: '18px' }}>{formatCurrency(selectedProject.materials_spent)} <span style={{ color: '#888', fontSize: '13px', fontWeight: '400' }}>of {formatCurrency(selectedProject.materials_budget)}</span></p>
                <div className="budget-bar"><div className={'budget-bar-fill ' + getBudgetClass(matPct)} style={{ width: matPct + '%' }} /></div>
              </div>
              <div className="card">
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>LABOR</p>
                <p style={{ fontWeight: '700', fontSize: '18px' }}>{formatCurrency(selectedProject.labor_spent)} <span style={{ color: '#888', fontSize: '13px', fontWeight: '400' }}>of {formatCurrency(selectedProject.labor_budget)}</span></p>
                <div className="budget-bar"><div className={'budget-bar-fill ' + getBudgetClass(labPct)} style={{ width: labPct + '%' }} /></div>
              </div>
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
                      <p style={{ fontSize: '11px', color: '#aaa' }}>{new Date(r.created_at).toLocaleDateString()}</p>
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
                    </div>
                    <p style={{ fontWeight: '700', color: '#1C2B3A' }}>{t.labor_cost ? formatCurrency(t.labor_cost) : '—'}</p>
                  </div>
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

        {photoViewer && <PhotoViewer receipt={photoViewer} onClose={() => setPhotoViewer(null)} />}
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
                  const matPct = getBudgetPct(p.materials_spent, p.materials_budget)
                  const labPct = getBudgetPct(p.labor_spent, p.labor_budget)
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#888', marginBottom: '4px' }}><span>Materials</span><span>{formatCurrency(p.materials_spent)} / {formatCurrency(p.materials_budget)}</span></div>
                      <div className="budget-bar"><div className={'budget-bar-fill ' + getBudgetClass(matPct)} style={{ width: matPct + '%' }} /></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#888', margin: '6px 0 4px' }}><span>Labor</span><span>{formatCurrency(p.labor_spent)} / {formatCurrency(p.labor_budget)}</span></div>
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
                        {p.completed_at && <p style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>Completed {new Date(p.completed_at).toLocaleDateString()}</p>}
                      </div>
                      <span className="status-pill status-end">✓ Done</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {projects.length === 0 && <div className="empty-state"><p>No jobs yet. Create your first job!</p></div>}
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
            {workers.length === 0 && <div className="empty-state"><p>No workers yet. Ask your crew to sign up and enter your email to link up.</p></div>}
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
                <div className="card" style={{ background: '#1C2B3A', color: 'white' }}>
                  <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>{reportYear} Summary</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div><p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Jobs Completed</p><p style={{ fontSize: '20px', fontWeight: '700' }}>{reportJobs.length}</p></div>
                    <div><p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Total Revenue</p><p style={{ fontSize: '20px', fontWeight: '700' }}>{formatCurrency(reportJobs.reduce((s, p) => s + (p.budget || 0), 0))}</p></div>
                    <div><p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Total Materials</p><p style={{ fontSize: '20px', fontWeight: '700' }}>{formatCurrency(reportJobs.reduce((s, p) => s + (p.materials_spent || 0), 0))}</p></div>
                    <div><p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Total Labor</p><p style={{ fontSize: '20px', fontWeight: '700' }}>{formatCurrency(reportJobs.reduce((s, p) => s + (p.labor_spent || 0), 0))}</p></div>
                  </div>
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>Net Profit</p>
                    <p style={{ fontSize: '28px', fontWeight: '800', color: '#16A34A' }}>
                      {formatCurrency(reportJobs.reduce((s, p) => s + (p.budget || 0) - (p.materials_spent || 0) - (p.labor_spent || 0), 0))}
                    </p>
                  </div>
                </div>
                {reportJobs.map(p => {
                  const profit = (p.budget || 0) - (p.materials_spent || 0) - (p.labor_spent || 0)
                  const margin = p.budget > 0 ? Math.round((profit / p.budget) * 100) : 0
                  return (
                    <div key={p.id} className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                        <div><h3>{p.name}</h3><p>{p.client_name}</p></div>
                        <span style={{ fontSize: '14px', fontWeight: '700', color: profit >= 0 ? '#16A34A' : '#DC2626' }}>{margin}%</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '13px' }}>
                        <div><span style={{ color: '#888' }}>Revenue</span><p style={{ fontWeight: '600' }}>{formatCurrency(p.budget)}</p></div>
                        <div><span style={{ color: '#888' }}>Profit</span><p style={{ fontWeight: '600', color: profit >= 0 ? '#16A34A' : '#DC2626' }}>{formatCurrency(profit)}</p></div>
                        <div><span style={{ color: '#888' }}>Materials</span><p style={{ fontWeight: '600' }}>{formatCurrency(p.materials_spent)}</p></div>
                        <div><span style={{ color: '#888' }}>Labor</span><p style={{ fontWeight: '600' }}>{formatCurrency(p.labor_spent)}</p></div>
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