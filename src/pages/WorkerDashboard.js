import React, { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

export default function WorkerDashboard({ profile }) {
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
    const { data: assignments } = await supabase
      .from('project_workers')
      .select('project_id')
      .eq('worker_id', profile.id)
    if (assignments?.length) {
      const ids = assignments.map(a => a.project_id)
      const { data } = await supabase
        .from('projects')
        .select('*')
        .in('id', ids)
        .neq('stage', 'end')
      setProjects(data || [])
    }
  }

  const fetchSchedule = async () => {
    const { data } = await supabase
      .from('schedule_entries')
      .select('*, projects(name)')
      .eq('worker_id', profile.id)
      .gte('scheduled_date', new Date().toISOString().split('T')[0])
      .order('scheduled_date', { ascending: true })
    setSchedule(data || [])
  }

  const checkActiveEntry = async () => {
    const { data } = await supabase
      .from('time_entries')
      .select('*')
      .eq('worker_id', profile.id)
      .is('clocked_out_at', null)
      .single()
    if (data) setActiveEntry(data)
  }

  const clockIn = async () => {
    if (!selectedProject) return alert('Select a job first')
    setLoading(true)
    const { data } = await supabase
      .from('time_entries')
      .insert({ project_id: selectedProject, worker_id: profile.id })
      .select()
      .single()
    setActiveEntry(data)
    setLoading(false)
  }

  const clockOut = async () => {
    setLoading(true)
    const now = new Date()
    const clockedIn = new Date(activeEntry.clocked_in_at)
    const totalMinutes = Math.floor((now - clockedIn) / 60000)
    const laborCost = (totalMinutes / 60) * (profile.hourly_rate || 0)
    await supabase.from('time_entries').update({
      clocked_out_at: now.toISOString(),
      total_minutes: totalMinutes,
      labor_cost: laborCost
    }).eq('id', activeEntry.id)
    const { data: project } = await supabase
      .from('projects')
      .select('labor_spent')
      .eq('id', activeEntry.project_id)
      .single()
    await supabase.from('projects').update({
      labor_spent: (project?.labor_spent || 0) + laborCost
    }).eq('id', activeEntry.project_id)
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

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <div>
      <div className="topbar">
        <h1>RUN-SITE</h1>
        <button onClick={handleSignOut}>Sign Out</button>
      </div>
      <div className="tabs" style={{ margin: '16px 16px 0' }}>
        <button className={`tab ${activeTab === 'clock' ? 'active' : ''}`} onClick={() => setActiveTab('clock')}>Clock In/Out</button>
        <button className={`tab ${activeTab === 'schedule' ? 'active' : ''}`} onClick={() => setActiveTab('schedule')}>My Schedule</button>
      </div>
      <div className="page">
        {activeTab === 'clock' && (
          <div>
            <div className="card" style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '13px', color: '#888', marginBottom: '4px' }}>
                {activeEntry ? 'Currently clocked in' : 'Not clocked in'}
              </p>
              <div className="timer-display">{formatTime(timer)}</div>
              {!activeEntry && (
                <div className="input-group" style={{ marginBottom: '12px' }}>
                  <label>Select Job</label>
                  <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)}>
                    <option value="">-- Choose a job --</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {activeEntry ? (
                <button className="btn-danger" onClick={clockOut} disabled={loading}>
                  {loading ? 'Clocking Out...' : 'Clock Out'}
                </button>
              ) : (
                <button className="btn-primary" onClick={clockIn} disabled={loading}>
                  {loading ? 'Clocking In...' : 'Clock In'}
                </button>
              )}
            </div>
            {activeEntry && (
              <div className="card">
                <p style={{ fontSize: '13px', color: '#888' }}>Job</p>
                <p style={{ fontWeight: '600' }}>{projects.find(p => p.id === activeEntry.project_id)?.name || 'Active Job'}</p>
              </div>
            )}
          </div>
        )}
        {activeTab === 'schedule' && (
          <div>
            {schedule.length === 0 ? (
              <div className="empty-state"><p>No upcoming schedule</p></div>
            ) : (
              schedule.map(entry => (
                <div key={entry.id} className="card">
                  <p className="schedule-day">
                    {new Date(entry.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  </p>
                  <h3>{entry.projects?.name}</h3>
                  <p>{entry.task_description}</p>
                  {entry.start_time && (
                    <p style={{ fontSize: '12px', color: '#E07B2A', marginTop: '4px', fontWeight: '600' }}>
                      {entry.start_time} — {entry.end_time}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}