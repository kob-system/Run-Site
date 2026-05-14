import React, { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

export default function OwnerDashboard({ profile }) {
  const [activeTab, setActiveTab] = useState('jobs')
  const [projects, setProjects] = useState([])
  const [workers, setWorkers] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [projectTab, setProjectTab] = useState('receipts')
  const [receipts, setReceipts] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [scheduleEntries, setScheduleEntries] = useState([])
  const [showNewJob, setShowNewJob] = useState(false)
  const [showNewReceipt, setShowNewReceipt] = useState(false)
  const [showNewWorker, setShowNewWorker] = useState(false)
  const [showNewSchedule, setShowNewSchedule] = useState(false)
  const [loading, setLoading] = useState(false)

  const [jobForm, setJobForm] = useState({ name: '', client_name: '', materials_budget: '', labor_budget: '', profit_target: '' })
  const [receiptForm, setReceiptForm] = useState({ description: '', store: '', amount: '', category: 'materials' })
  const [workerForm, setWorkerForm] = useState({ email: '', full_name: '', hourly_rate: '' })
  const [scheduleForm, setScheduleForm] = useState({ worker_id: '', task_description: '', scheduled_date: '', start_time: '', end_time: '' })

  useEffect(() => { fetchProjects(); fetchWorkers() }, [])

  const fetchProjects = async () => {
    const { data } = await supabase.from('projects').select('*').eq('owner_id', profile.id).order('created_at', { ascending: false })
    setProjects(data || [])
  }

  const fetchWorkers = async () => {
    const { data } = await supabase.from('profiles').select('*').eq('owner_id', profile.id)
    setWorkers(data || [])
  }

  const fetchProjectDetails = async (project) => {
    setSelectedProject(project)
    const { data: r } = await supabase.from('receipts').select('*').eq('project_id', project.id).order('created_at', { ascending: false })
    setReceipts(r || [])
    const { data: t } = await supabase.from('time_entries').select('*, profiles(full_name)').eq('project_id', project.id).order('clocked_in_at', { ascending: false })
    setTimeEntries(t || [])
    const { data: s } = await supabase.from('schedule_entries').select('*, profiles(full_name)').eq('project_id', project.id).order('scheduled_date', { ascending: true })
    setScheduleEntries(s || [])
  }

  const createJob = async () => {
    setLoading(true)
    const total = parseFloat(jobForm.materials_budget || 0) + parseFloat(jobForm.labor_budget || 0) + parseFloat(jobForm.profit_target || 0)
    await supabase.from('projects').insert({
      owner_id: profile.id,
      name: jobForm.name,
      client_name: jobForm.client_name,
      budget: total,
      materials_budget: parseFloat(jobForm.materials_budget || 0),
      labor_budget: parseFloat(jobForm.labor_budget || 0),
      profit_target: parseFloat(jobForm.profit_target || 0),
      stage: 'start'
    })
    setShowNewJob(false)
    setJobForm({ name: '', client_name: '', materials_budget: '', labor_budget: '', profit_target: '' })
    fetchProjects()
    setLoading(false)
  }

  const addReceipt = async () => {
    setLoading(true)
    const amount = parseFloat(receiptForm.amount)
    await supabase.from('receipts').insert({
      project_id: selectedProject.id,
      owner_id: profile.id,
      description: receiptForm.description,
      store: receiptForm.store,
      amount,
      category: receiptForm.category
    })
    if (receiptForm.category === 'materials') {
      const { data: p } = await supabase.from('projects').select('materials_spent').eq('id', selectedProject.id).single()
      await supabase.from('projects').update({ materials_spent: (p?.materials_spent || 0) + amount }).eq('id', selectedProject.id)
    }
    setShowNewReceipt(false)
    setReceiptForm({ description: '', store: '', amount: '', category: 'materials' })
    fetchProjectDetails(selectedProject)
    fetchProjects()
    setLoading(false)
  }

  const addWorker = async () => {
    setLoading(true)
    const { data, error } = await supabase.auth.admin ? 
      { data: null, error: 'use signup' } : 
      await supabase.auth.signUp({ email: workerForm.email, password: 'RunSite2024!' })
    if (data?.user) {
      await supabase.from('profiles').insert({
        id: data.user.id,
        email: workerForm.email,
        full_name: workerForm.full_name,
        role: 'worker',
        owner_id: profile.id,
        hourly_rate: parseFloat(workerForm.hourly_rate || 0)
      })
    }
    setShowNewWorker(false)
    setWorkerForm({ email: '', full_name: '', hourly_rate: '' })
    fetchWorkers()
    setLoading(false)
  }

  const addSchedule = async () => {
    setLoading(true)
    await supabase.from('schedule_entries').insert({
      owner_id: profile.id,
      worker_id: scheduleForm.worker_id,
      project_id: selectedProject.id,
      task_description: scheduleForm.task_description,
      scheduled_date: scheduleForm.scheduled_date,
      start_time: scheduleForm.start_time,
      end_time: scheduleForm.end_time
    })
    setShowNewSchedule(false)
    setScheduleForm({ worker_id: '', task_description: '', scheduled_date: '', start_time: '', end_time: '' })
    fetchProjectDetails(selectedProject)
    setLoading(false)
  }

  const advanceStage = async (project) => {
    const stages = ['start', 'mid', 'end']
    const current = stages.indexOf(project.stage)
    if (current < 2) {
      const next = stages[current + 1]
      await supabase.from('projects').update({ stage: next, ...(next === 'end' ? { completed_at: new Date().toISOString() } : {}) }).eq('id', project.id)
      fetchProjects()
      if (selectedProject?.id === project.id) setSelectedProject({ ...project, stage: next })
    }
  }

  const getBudgetPct = (spent, budget) => budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
  const getBudgetClass = (pct) => pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : ''
  const formatCurrency = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`
  const formatTime = (mins) => { const h = Math.floor((mins || 0) / 60); const m = (mins || 0) % 60; return `${h}h ${m}m` }

  const handleSignOut = async () => { await supabase.auth.signOut() }

  if (selectedProject) {
    const matPct = getBudgetPct(selectedProject.materials_spent, selectedProject.materials_budget)
    const labPct = getBudgetPct(selectedProject.labor_spent, selectedProject.labor_budget)
    return (
      <div>
        <div className="topbar">
          <button onClick={() => setSelectedProject(null)} style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer', padding: '0' }}>←</button>
          <h1 style={{ fontSize: '16px' }}>{selectedProject.name}</h1>
          <span className={`status-pill status-${selectedProject.stage}`}>{selectedProject.stage}</span>
        </div>

        {matPct >= 80 && <div className={matPct >= 100 ? 'alert-danger' : 'alert-warning'} style={{ margin: '12px 16px 0' }}>
          {matPct >= 100 ? '🔴 Materials over budget!' : '⚠️ Materials at ' + Math.round(matPct) + '% of budget'}
        </div>}
        {labPct >= 80 && <div className={labPct >= 100 ? 'alert-danger' : 'alert-warning'} style={{ margin: '8px 16px 0' }}>
          {labPct >= 100 ? '🔴 Labor over budget!' : '⚠️ Labor at ' + Math.round(labPct) + '% of budget'}
        </div>}

        <div className="tabs" style={{ margin: '16px 16px 0' }}>
          {['receipts','time','budget','schedule'].map(t => (
            <button key={t} className={`tab ${projectTab === t ? 'active' : ''}`} onClick={() => setProjectTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="page">
          {projectTab === 'budget' && (
            <div>
              <div className="card">
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>MATERIALS</p>
                <p style={{ fontWeight: '700', fontSize: '18px' }}>{formatCurrency(selectedProject.materials_spent)} <span style={{ color: '#888', fontSize: '13px', fontWeight: '400' }}>of {formatCurrency(selectedProject.materials_budget)}</span></p>
                <div className="budget-bar"><div className={`budget-bar-fill ${getBudgetClass(matPct)}`} style={{ width: matPct + '%' }} /></div>
              </div>
              <div className="card">
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>LABOR</p>
                <p style={{ fontWeight: '700', fontSize: '18px' }}>{formatCurrency(selectedProject.labor_spent)} <span style={{ color: '#888', fontSize: '13px', fontWeight: '400' }}>of {formatCurrency(selectedProject.labor_budget)}</span></p>
                <div className="budget-bar"><div className={`budget-bar-fill ${getBudgetClass(labPct)}`} style={{ width: labPct + '%' }} /></div>
              </div>
              <div className="card">
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>PROJECTED PROFIT</p>
                <p style={{ fontWeight: '700', fontSize: '22px', color: '#16A34A' }}>{formatCurrency(selectedProject.profit_target - (selectedProject.materials_spent - selectedProject.materials_budget > 0 ? selectedProject.materials_spent - selectedProject.materials_budget : 0))}</p>
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
              <button className="btn-primary" onClick={() => setShowNewReceipt(true)}>+ Add Receipt</button>
              {receipts.map(r => (
                <div key={r.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3>{r.description}</h3>
                      <p>{r.store} · {r.category}</p>
                      <p style={{ fontSize: '11px', color: '#aaa' }}>{new Date(r.created_at).toLocaleDateString()}</p>
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
                      <h3>{t.profiles?.full_name || 'Worker'}</h3>
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
              <button className="btn-primary" onClick={() => setShowNewSchedule(true)}>+ Schedule Worker</button>
              {scheduleEntries.map(s => (
                <div key={s.id} className="card">
                  <p className="schedule-day">{new Date(s.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                  <h3>{s.profiles?.full_name}</h3>
                  <p>{s.task_description}</p>
                  {s.start_time && <p style={{ fontSize: '12px', color: '#E07B2A', marginTop: '4px', fontWeight: '600' }}>{s.start_time} — {s.end_time}</p>}
                </div>
              ))}
              {scheduleEntries.length === 0 && <div className="empty-state"><p>No schedule yet</p></div>}
            </div>
          )}
        </div>

        {showNewReceipt && (
          <div className="modal-overlay" onClick={() => setShowNewReceipt(false)}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Add Receipt</h2>
              <div className="input-group"><label>Description</label><input value={receiptForm.description} onChange={e => setReceiptForm({...receiptForm, description: e.target.value})} placeholder="Concrete mix" /></div>
              <div className="input-group"><label>Store</label><input value={receiptForm.store} onChange={e => setReceiptForm({...receiptForm, store: e.target.value})} placeholder="Home Depot" /></div>
              <div className="input-group"><label>Amount ($)</label><input type="number" value={receiptForm.amount} onChange={e => setReceiptForm({...receiptForm, amount: e.target.value})} placeholder="0.00" /></div>
              <div className="input-group"><label>Category</label><select value={receiptForm.category} onChange={e => setReceiptForm({...receiptForm, category: e.target.value})}><option value="materials">Materials</option><option value="other">Other</option></select></div>
              <button className="btn-primary" onClick={addReceipt} disabled={loading}>{loading ? 'Saving...' : 'Add Receipt'}</button>
              <button className="btn-secondary" onClick={() => setShowNewReceipt(false)}>Cancel</button>
            </div>
          </div>
        )}

        {showNewSchedule && (
          <div className="modal-overlay" onClick={() => setShowNewSchedule(false)}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Schedule Worker</h2>
              <div className="input-group"><label>Worker</label><select value={scheduleForm.worker_id} onChange={e => setScheduleForm({...scheduleForm, worker_id: e.target.value})}><option value="">Select worker</option>{workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}</select></div>
              <div className="input-group"><label>Task</label><input value={scheduleForm.task_description} onChange={e => setScheduleForm({...scheduleForm, task_description: e.target.value})} placeholder="Pour foundation" /></div>
              <div className="input-group"><label>Date</label><input type="date" value={scheduleForm.scheduled_date} onChange={e => setScheduleForm({...scheduleForm, scheduled_date: e.target.value})} /></div>
              <div className="input-group"><label>Start Time</label><input type="time" value={scheduleForm.start_time} onChange={e => setScheduleForm({...scheduleForm, start_time: e.target.value})} /></div>
              <div className="input-group"><label>End Time</label><input type="time" value={scheduleForm.end_time} onChange={e => setScheduleForm({...scheduleForm, end_time: e.target.value})} /></div>
              <button className="btn-primary" onClick={addSchedule} disabled={loading}>{loading ? 'Saving...' : 'Schedule'}</button>
              <button className="btn-secondary" onClick={() => setShowNewSchedule(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="topbar">
        <h1>RUN-SITE</h1>
        <button onClick={handleSignOut}>Sign Out</button>
      </div>

      <div className="tabs" style={{ margin: '16px 16px 0' }}>
        {['jobs','workers','reports'].map(t => (
          <button key={t} className={`tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="page">
        {activeTab === 'jobs' && (
          <div>
            <div className="stats-row">
              <div className="stat-card"><div className="stat-value">{projects.filter(p => p.stage !== 'end').length}</div><div className="stat-label">Active Jobs</div></div>
              <div className="stat-card"><div className="stat-value">{projects.filter(p => p.stage === 'end').length}</div><div className="stat-label">Completed</div></div>
            </div>
            <button className="btn-primary" onClick={() => setShowNewJob(true)}>+ New Job</button>
            <div style={{ marginTop: '12px' }}>
              {projects.map(p => {
                const matPct = getBudgetPct(p.materials_spent, p.materials_budget)
                const labPct = getBudgetPct(p.labor_spent, p.labor_budget)
                return (
                  <div key={p.id} className="card" onClick={() => fetchProjectDetails(p)} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div>
                        <h3>{p.name}</h3>
                        <p>{p.client_name}</p>
                      </div>
                      <span className={`status-pill status-${p.stage}`}>{p.stage}</span>
                    </div>
                    {(matPct >= 80 || labPct >= 80) && (
                      <div className={matPct >= 100 || labPct >= 100 ? 'alert-danger' : 'alert-warning'} style={{ marginBottom: '8px' }}>
                        {matPct >= 100 || labPct >= 100 ? '🔴 Over budget' : '⚠️ Approaching budget limit'}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                      <span>Materials</span><span>{formatCurrency(p.materials_spent)} / {formatCurrency(p.materials_budget)}</span>
                    </div>
                    <div className="budget-bar"><div className={`budget-bar-fill ${getBudgetClass(matPct)}`} style={{ width: matPct + '%' }} /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#888', margin: '6px 0 4px' }}>
                      <span>Labor</span><span>{formatCurrency(p.labor_spent)} / {formatCurrency(p.labor_budget)}</span>
                    </div>
                    <div className="budget-bar"><div className={`budget-bar-fill ${getBudgetClass(labPct)}`} style={{ width: labPct + '%' }} /></div>
                  </div>
                )
              })}
              {projects.length === 0 && <div className="empty-state"><p>No jobs yet. Create your first job!</p></div>}
            </div>
          </div>
        )}

        {activeTab === 'workers' && (
          <div>
            <button className="btn-primary" onClick={() => setShowNewWorker(true)}>+ Add Worker</button>
            <div style={{ marginTop: '12px' }}>
              {workers.map(w => (
                <div key={w.id} className="card">
                  <h3>{w.full_name}</h3>
                  <p>{w.email}</p>
                  <p style={{ color: '#E07B2A', fontWeight: '600', marginTop: '4px' }}>${w.hourly_rate || 0}/hr</p>
                </div>
              ))}
              {workers.length === 0 && <div className="empty-state"><p>No workers yet</p></div>}
            </div>
          </div>
        )}

        {activeTab === 'reports' && (
          <div>
            <div className="card">
              <h3>Year Summary</h3>
              <p style={{ marginTop: '8px' }}>Total Jobs: {projects.length}</p>
              <p>Completed: {projects.filter(p => p.stage === 'end').length}</p>
              <p>Total Materials: {formatCurrency(projects.reduce((sum, p) => sum + (p.materials_spent || 0), 0))}</p>
              <p>Total Labor: {formatCurrency(projects.reduce((sum, p) => sum + (p.labor_spent || 0), 0))}</p>
            </div>
            {projects.filter(p => p.stage === 'end').map(p => (
              <div key={p.id} className="card">
                <h3>{p.name}</h3>
                <p>{p.client_name}</p>
                <p style={{ marginTop: '8px' }}>Materials: {formatCurrency(p.materials_spent)}</p>
                <p>Labor: {formatCurrency(p.labor_spent)}</p>
                <p style={{ color: '#16A34A', fontWeight: '600', marginTop: '4px' }}>Profit target: {formatCurrency(p.profit_target)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNewJob && (
        <div className="modal-overlay" onClick={() => setShowNewJob(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>New Job</h2>
            <div className="input-group"><label>Job Name</label><input value={jobForm.name} onChange={e => setJobForm({...jobForm, name: e.target.value})} placeholder="18 Dutch Village" /></div>
            <div className="input-group"><label>Client Name</label><input value={jobForm.client_name} onChange={e => setJobForm({...jobForm, client_name: e.target.value})} placeholder="John Smith" /></div>
            <div className="input-group"><label>Materials Budget ($)</label><input type="number" value={jobForm.materials_budget} onChange={e => setJobForm({...jobForm, materials_budget: e.target.value})} placeholder="3000" /></div>
            <div className="input-group"><label>Labor Budget ($)</label><input type="number" value={jobForm.labor_budget} onChange={e => setJobForm({...jobForm, labor_budget: e.target.value})} placeholder="1000" /></div>
            <div className="input-group"><label>Profit Target ($)</label><input type="number" value={jobForm.profit_target} onChange={e => setJobForm({...jobForm, profit_target: e.target.value})} placeholder="1000" /></div>
            <button className="btn-primary" onClick={createJob} disabled={loading}>{loading ? 'Creating...' : 'Create Job'}</button>
            <button className="btn-secondary" onClick={() => setShowNewJob(false)}>Cancel</button>
          </div>
        </div>
      )}

      {showNewWorker && (
        <div className="modal-overlay" onClick={() => setShowNewWorker(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>Add Worker</h2>
            <div className="input-group"><label>Full Name</label><input value={workerForm.full_name} onChange={e => setWorkerForm({...workerForm, full_name: e.target.value})} placeholder="Mike Johnson" /></div>
            <div className="input-group"><label>Email</label><input type="email" value={workerForm.email} onChange={e => setWorkerForm({...workerForm, email: e.target.value})} placeholder="mike@email.com" /></div>
            <div className="input-group"><label>Hourly Rate ($)</label><input type="number" value={workerForm.hourly_rate} onChange={e => setWorkerForm({...workerForm, hourly_rate: e.target.value})} placeholder="22" /></div>
            <button className="btn-primary" onClick={addWorker} disabled={loading}>{loading ? 'Adding...' : 'Add Worker'}</button>
            <button className="btn-secondary" onClick={() => setShowNewWorker(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}