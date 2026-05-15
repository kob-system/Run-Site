import React, { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignup, setIsSignup] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

const handleSignup = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id, email, full_name: name, company_name: company, role: 'owner'
      })
      if (profileError) { setError('Account created but profile failed: ' + profileError.message); setLoading(false); return }
      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
      setLoading(false)
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#1C2B3A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ marginBottom: '32px', textAlign: 'center' }}>
        <h1 style={{ color: '#E07B2A', fontSize: '32px', fontWeight: '800' }}>RUN-SITE</h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', marginTop: '6px' }}>Contractor job tracking — from your phone</p>
      </div>
      <div style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '400px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '20px', color: '#1C2B3A' }}>{isSignup ? 'Create Account' : 'Sign In'}</h2>
        {error && <div className="alert-danger">{error}</div>}
        <form onSubmit={isSignup ? handleSignup : handleLogin}>
          {isSignup && (
            <>
              <div className="input-group"><label>Full Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Josh Smith" required /></div>
              <div className="input-group"><label>Company Name</label><input type="text" value={company} onChange={e => setCompany(e.target.value)} placeholder="First Class Property Services" required /></div>
            </>
          )}
          <div className="input-group"><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" required /></div>
          <div className="input-group"><label>Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required /></div>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Loading...' : isSignup ? 'Create Account' : 'Sign In'}</button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '14px', color: '#666' }}>
          {isSignup ? 'Already have an account?' : "Don't have an account?"}
          <button onClick={() => { setIsSignup(!isSignup); setError('') }} style={{ background: 'none', border: 'none', color: '#E07B2A', fontWeight: '600', cursor: 'pointer', marginLeft: '6px' }}>{isSignup ? 'Sign In' : 'Sign Up'}</button>
        </p>
      </div>
    </div>
  )
}

function WorkerDashboard({ profile }) {
  const [activeTab, setActiveTab] = useState('clock')
  const [projects, setProjects] = useState([])
  const [activeEntry, setActiveEntry] = useState(null)
  const [selectedProject, setSelectedProject] = useState('')
  const [timer, setTimer] = useState(0)
  const [schedule, setSchedule] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchAssignedProjects()
    fetchSchedule()
    checkActiveEntry()
  }, [])

  useEffect(() => {
    let interval
    if (activeEntry) {
      interval = setInterval(() => {
        const diff = Math.floor((Date.now() - new Date(activeEntry.clocked_in_at).getTime()) / 1000)
        setTimer(diff)
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [activeEntry])

  const fetchAssignedProjects = async () => {
    const { data: assignments } = await supabase.from('project_workers').select('project_id').eq('worker_id', profile.id)
    if (assignments?.length) {
      const ids = assignments.map(a => a.project_id)
      const { data } = await supabase.from('projects').select('*').in('id', ids).neq('stage', 'end')
      setProjects(data || [])
    }
  }

  const fetchSchedule = async () => {
    const { data } = await supabase.from('schedule_entries').select('*, projects(name)').eq('worker_id', profile.id).gte('scheduled_date', new Date().toISOString().split('T')[0]).order('scheduled_date', { ascending: true })
    setSchedule(data || [])
  }

  const checkActiveEntry = async () => {
    const { data } = await supabase.from('time_entries').select('*').eq('worker_id', profile.id).is('clocked_out_at', null).single()
    if (data) setActiveEntry(data)
  }

  const clockIn = async () => {
    if (!selectedProject) return alert('Select a job first')
    setLoading(true)
    const { data } = await supabase.from('time_entries').insert({ project_id: selectedProject, worker_id: profile.id }).select().single()
    setActiveEntry(data)
    setLoading(false)
  }

  const clockOut = async () => {
    setLoading(true)
    const now = new Date()
    const clockedIn = new Date(activeEntry.clocked_in_at)
    const totalMinutes = Math.floor((now - clockedIn) / 60000)
    const laborCost = (totalMinutes / 60) * (profile.hourly_rate || 0)
    await supabase.from('time_entries').update({ clocked_out_at: now.toISOString(), total_minutes: totalMinutes, labor_cost: laborCost }).eq('id', activeEntry.id)
    const { data: project } = await supabase.from('projects').select('labor_spent').eq('id', activeEntry.project_id).single()
    await supabase.from('projects').update({ labor_spent: (project?.labor_spent || 0) + laborCost }).eq('id', activeEntry.project_id)
    setActiveEntry(null)
    setTimer(0)
    setLoading(false)
  }

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  }

  return (
    <div>
      <div className="topbar"><h1>RUN-SITE</h1><button onClick={() => supabase.auth.signOut()}>Sign Out</button></div>
      <div className="tabs" style={{ margin: '16px 16px 0' }}>
        <button className={'tab ' + (activeTab === 'clock' ? 'active' : '')} onClick={() => setActiveTab('clock')}>Clock In/Out</button>
        <button className={'tab ' + (activeTab === 'schedule' ? 'active' : '')} onClick={() => setActiveTab('schedule')}>My Schedule</button>
      </div>
      <div className="page">
        {activeTab === 'clock' && (
          <div>
            <div className="card" style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '13px', color: '#888', marginBottom: '4px' }}>{activeEntry ? 'Currently clocked in' : 'Not clocked in'}</p>
              <div className="timer-display">{formatTime(timer)}</div>
              {!activeEntry && (
                <div className="input-group" style={{ marginBottom: '12px' }}>
                  <label>Select Job</label>
                  <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)}>
                    <option value="">-- Choose a job --</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              {activeEntry ? (
                <button className="btn-danger" onClick={clockOut} disabled={loading}>{loading ? 'Clocking Out...' : 'Clock Out'}</button>
              ) : (
                <button className="btn-primary" onClick={clockIn} disabled={loading}>{loading ? 'Clocking In...' : 'Clock In'}</button>
              )}
            </div>
          </div>
        )}
        {activeTab === 'schedule' && (
          <div>
            {schedule.length === 0 ? <div className="empty-state"><p>No upcoming schedule</p></div> : schedule.map(entry => (
              <div key={entry.id} className="card">
                <p className="schedule-day">{new Date(entry.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                <h3>{entry.projects?.name}</h3>
                <p>{entry.task_description}</p>
                {entry.start_time && <p style={{ fontSize: '12px', color: '#E07B2A', marginTop: '4px', fontWeight: '600' }}>{entry.start_time} — {entry.end_time}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function OwnerDashboard({ profile }) {
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
  const [scanning, setScanning] = useState(false)
  const [jobForm, setJobForm] = useState({ name: '', client_name: '', materials_budget: '', labor_budget: '', profit_target: '' })
  const [receiptForm, setReceiptForm] = useState({ description: '', store: '', amount: '', category: 'materials' })
  const [workerForm, setWorkerForm] = useState({ email: '', full_name: '', hourly_rate: '' })
  const [scheduleForm, setScheduleForm] = useState({ worker_id: '', task_description: '', scheduled_date: '', start_time: '', end_time: '' })

  useEffect(() => { fetchProjects(); fetchWorkers() }, [])

  const fetchProjects = async () => {
    const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    if (error) console.log('Fetch error:', error)
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
    const { error } = await supabase.from('projects').insert({ owner_id: profile.id, name: jobForm.name, client_name: jobForm.client_name, budget: total, materials_budget: parseFloat(jobForm.materials_budget || 0), labor_budget: parseFloat(jobForm.labor_budget || 0), profit_target: parseFloat(jobForm.profit_target || 0), stage: 'start' })
    if (error) console.log('Create job error:', error)
    setShowNewJob(false)
    setJobForm({ name: '', client_name: '', materials_budget: '', labor_budget: '', profit_target: '' })
    await fetchProjects()
    setLoading(false)
  }

  const scanReceipt = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setScanning(true)
    const reader = new FileReader()
    reader.onload = async (event) => {
      const base64 = event.target.result.split(',')[1]
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.REACT_APP_ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } },
                { type: 'text', text: 'Look at this receipt and extract: 1) store name, 2) total amount. Reply in this exact format only: STORE: [store name] AMOUNT: [number only, no $ sign]' }
              ]
            }]
          })
        })
        const data = await response.json()
        const text = data.content[0].text
        const storeMatch = text.match(/STORE:\s*(.+?)(?:\s+AMOUNT|$)/i)
        const amountMatch = text.match(/AMOUNT:\s*([\d.]+)/i)
        if (storeMatch) setReceiptForm(f => ({ ...f, store: storeMatch[1].trim() }))
        if (amountMatch) setReceiptForm(f => ({ ...f, amount: amountMatch[1] }))
      } catch (err) {
        console.log('Scan error:', err)
      }
      setScanning(false)
    }
    reader.readAsDataURL(file)
  }

  const addReceipt = async () => {
    setLoading(true)
    const amount = parseFloat(receiptForm.amount)
    await supabase.from('receipts').insert({ project_id: selectedProject.id, owner_id: profile.id, description: receiptForm.description, store: receiptForm.store, amount, category: receiptForm.category })
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
    const workerId = crypto.randomUUID()
    const { error: insertError } = await supabase.from('profiles').insert({ 
      id: workerId, 
      email: workerForm.email, 
      full_name: workerForm.full_name, 
      role: 'worker', 
      owner_id: profile.id, 
      hourly_rate: parseFloat(workerForm.hourly_rate || 0) 
    })
    if (insertError) console.log('Worker insert error:', insertError)
    setShowNewWorker(false)
    setWorkerForm({ email: '', full_name: '', hourly_rate: '' })
    fetchWorkers()
    setLoading(false)
  }

  const addSchedule = async () => {
    setLoading(true)
    await supabase.from('schedule_entries').insert({ owner_id: profile.id, worker_id: scheduleForm.worker_id, project_id: selectedProject.id, task_description: scheduleForm.task_description, scheduled_date: scheduleForm.scheduled_date, start_time: scheduleForm.start_time, end_time: scheduleForm.end_time })
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
  const formatCurrency = (n) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })
  const formatTime = (mins) => Math.floor((mins || 0) / 60) + 'h ' + ((mins || 0) % 60) + 'm'

  if (selectedProject) {
    const matPct = getBudgetPct(selectedProject.materials_spent, selectedProject.materials_budget)
    const labPct = getBudgetPct(selectedProject.labor_spent, selectedProject.labor_budget)
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
              {selectedProject.stage !== 'end' && (
                <button className="btn-secondary" onClick={() => advanceStage(selectedProject)}>{selectedProject.stage === 'start' ? 'Advance to Mid →' : 'Mark as Complete ✓'}</button>
              )}
            </div>
          )}
          {projectTab === 'receipts' && (
            <div>
              <button className="btn-primary" onClick={() => setShowNewReceipt(true)}>+ Add Receipt</button>
              {receipts.map(r => (
                <div key={r.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div><h3>{r.description}</h3><p>{r.store} · {r.category}</p><p style={{ fontSize: '11px', color: '#aaa' }}>{new Date(r.created_at).toLocaleDateString()}</p></div>
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
                    <div><h3>{t.profiles ? t.profiles.full_name : 'Worker'}</h3><p>{new Date(t.clocked_in_at).toLocaleDateString()}</p><p>{t.total_minutes ? formatTime(t.total_minutes) : 'Still clocked in'}</p></div>
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
          <div className="modal-overlay" onClick={() => setShowNewReceipt(false)}>
            <div className="modal-sheet" onClick={e => e.stopPropagation()}>
              <h2>Add Receipt</h2>
              <div className="input-group">
                <label>📷 Scan Receipt Photo</label>
                <input type="file" accept="image/*" capture="environment" onChange={scanReceipt} style={{ padding: '8px 0' }} />
                {scanning && <p style={{ color: '#E07B2A', fontSize: '13px', marginTop: '6px' }}>🔍 Scanning receipt...</p>}
              </div>
              <div className="input-group"><label>Description</label><input value={receiptForm.description} onChange={e => setReceiptForm({ ...receiptForm, description: e.target.value })} placeholder="Concrete mix" /></div>
              <div className="input-group"><label>Store</label><input value={receiptForm.store} onChange={e => setReceiptForm({ ...receiptForm, store: e.target.value })} placeholder="Home Depot" /></div>
              <div className="input-group"><label>Amount ($)</label><input type="number" value={receiptForm.amount} onChange={e => setReceiptForm({ ...receiptForm, amount: e.target.value })} placeholder="0.00" /></div>
              <div className="input-group"><label>Category</label><select value={receiptForm.category} onChange={e => setReceiptForm({ ...receiptForm, category: e.target.value })}><option value="materials">Materials</option><option value="other">Other</option></select></div>
              <button className="btn-primary" onClick={addReceipt} disabled={loading}>{loading ? 'Saving...' : 'Add Receipt'}</button>
              <button className="btn-secondary" onClick={() => setShowNewReceipt(false)}>Cancel</button>
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
      <div className="topbar"><h1>RUN-SITE</h1><button onClick={() => supabase.auth.signOut()}>Sign Out</button></div>
      <div className="tabs" style={{ margin: '16px 16px 0' }}>
        {['jobs', 'workers', 'reports'].map(t => (
          <button key={t} className={'tab ' + (activeTab === t ? 'active' : '')} onClick={() => setActiveTab(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
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
                      <div><h3>{p.name}</h3><p>{p.client_name}</p></div>
                      <span className={'status-pill status-' + p.stage}>{p.stage}</span>
                    </div>
                    {(matPct >= 80 || labPct >= 80) && <div className={matPct >= 100 || labPct >= 100 ? 'alert-danger' : 'alert-warning'} style={{ marginBottom: '8px' }}>{matPct >= 100 || labPct >= 100 ? '🔴 Over budget' : '⚠️ Approaching limit'}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#888', marginBottom: '4px' }}><span>Materials</span><span>{formatCurrency(p.materials_spent)} / {formatCurrency(p.materials_budget)}</span></div>
                    <div className="budget-bar"><div className={'budget-bar-fill ' + getBudgetClass(matPct)} style={{ width: matPct + '%' }} /></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#888', margin: '6px 0 4px' }}><span>Labor</span><span>{formatCurrency(p.labor_spent)} / {formatCurrency(p.labor_budget)}</span></div>
                    <div className="budget-bar"><div className={'budget-bar-fill ' + getBudgetClass(labPct)} style={{ width: labPct + '%' }} /></div>
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
                <div key={w.id} className="card"><h3>{w.full_name}</h3><p>{w.email}</p><p style={{ color: '#E07B2A', fontWeight: '600', marginTop: '4px' }}>${w.hourly_rate || 0}/hr</p></div>
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
          </div>
        )}
      </div>
      {showNewJob && (
        <div className="modal-overlay" onClick={() => setShowNewJob(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>New Job</h2>
            <div className="input-group"><label>Job Name</label><input value={jobForm.name} onChange={e => setJobForm({ ...jobForm, name: e.target.value })} placeholder="18 Dutch Village" /></div>
            <div className="input-group"><label>Client Name</label><input value={jobForm.client_name} onChange={e => setJobForm({ ...jobForm, client_name: e.target.value })} placeholder="John Smith" /></div>
            <div className="input-group"><label>Materials Budget ($)</label><input type="number" value={jobForm.materials_budget} onChange={e => setJobForm({ ...jobForm, materials_budget: e.target.value })} placeholder="3000" /></div>
            <div className="input-group"><label>Labor Budget ($)</label><input type="number" value={jobForm.labor_budget} onChange={e => setJobForm({ ...jobForm, labor_budget: e.target.value })} placeholder="1000" /></div>
            <div className="input-group"><label>Profit Target ($)</label><input type="number" value={jobForm.profit_target} onChange={e => setJobForm({ ...jobForm, profit_target: e.target.value })} placeholder="1000" /></div>
            <button className="btn-primary" onClick={createJob} disabled={loading}>{loading ? 'Creating...' : 'Create Job'}</button>
            <button className="btn-secondary" onClick={() => setShowNewJob(false)}>Cancel</button>
          </div>
        </div>
      )}
      {showNewWorker && (
        <div className="modal-overlay" onClick={() => setShowNewWorker(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>Add Worker</h2>
            <div className="input-group"><label>Full Name</label><input value={workerForm.full_name} onChange={e => setWorkerForm({ ...workerForm, full_name: e.target.value })} placeholder="Mike Johnson" /></div>
            <div className="input-group"><label>Email</label><input type="email" value={workerForm.email} onChange={e => setWorkerForm({ ...workerForm, email: e.target.value })} placeholder="mike@email.com" /></div>
            <div className="input-group"><label>Hourly Rate ($)</label><input type="number" value={workerForm.hourly_rate} onChange={e => setWorkerForm({ ...workerForm, hourly_rate: e.target.value })} placeholder="22" /></div>
            <button className="btn-primary" onClick={addWorker} disabled={loading}>{loading ? 'Adding...' : 'Add Worker'}</button>
            <button className="btn-secondary" onClick={() => setShowNewWorker(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchProfile = async (userId) => {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (!data) {
        setTimeout(async () => {
          const { data: retryData } = await supabase.from('profiles').select('*').eq('id', userId).single()
          setProfile(retryData)
          setLoading(false)
        }, 2000)
        return
      }
      setProfile(data)
    } catch (e) {
      console.log('Profile error:', e)
    }
    setLoading(false)
  }

  if (loading) return <div className="loading">Loading Run-Site...</div>
  if (!session) return <Login />
  if (profile && profile.role === 'worker') return <WorkerDashboard profile={profile} />
  if (profile) return <OwnerDashboard profile={profile} />
  return <div className="loading">Loading...</div>
}

export default App