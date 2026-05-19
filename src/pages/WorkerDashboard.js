import React, { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { formatTime } from '../utils/formatTime'

export default function WorkerDashboard({ profile }) {
  const [activeTab, setActiveTab] = useState('clock')
  const [projects, setProjects] = useState([])
  const [activeEntry, setActiveEntry] = useState(null)
  const [selectedProject, setSelectedProject] = useState('')
  const [timer, setTimer] = useState(0)
  const [schedule, setSchedule] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

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
    try {
      const { data: assignments, error } = await supabase.from('project_workers').select('project_id').eq('worker_id', profile.id)
      if (error) throw error
      if (assignments?.length) {
        const ids = assignments.map(a => a.project_id)
        const { data, error: projError } = await supabase.from('projects').select('*').in('id', ids).neq('stage', 'end')
        if (projError) throw projError
        setProjects(data || [])
      }
    } catch (e) {
      setError('Could not load jobs. Check your connection.')
    }
  }

  const fetchSchedule = async () => {
    try {
      const { data, error } = await supabase.from('schedule_entries').select('*, projects(name)').eq('worker_id', profile.id).gte('scheduled_date', new Date().toISOString().split('T')[0]).order('scheduled_date', { ascending: true })
      if (error) throw error
      setSchedule(data || [])
    } catch (e) {
      console.error('Schedule fetch failed:', e)
    }
  }

  const checkActiveEntry = async () => {
    try {
      const { data, error } = await supabase.from('time_entries').select('*').eq('worker_id', profile.id).is('clocked_out_at', null).single()
      if (data) setActiveEntry(data)
    } catch (e) {
      // no active entry is fine
    }
  }

  const clockIn = async () => {
    if (!selectedProject) return setError('Select a job first')
    setLoading(true)
    setError('')
    try {
      // GPS
      let gpsLat = null
      let gpsLng = null
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
        })
        gpsLat = pos.coords.latitude
        gpsLng = pos.coords.longitude
      } catch (gpsErr) {
        // GPS failed — clock in anyway, just without location
      }

      const { data, error } = await supabase.from('time_entries').insert({
        project_id: selectedProject,
        worker_id: profile.id,
        gps_lat: gpsLat,
        gps_lng: gpsLng
      }).select().single()

      if (error) throw error
      setActiveEntry(data)
      setToast('Clocked in ✓')
    } catch (e) {
      setError('Clock-in failed. Try again.')
    }
    setLoading(false)
  }

  const clockOut = async () => {
    setLoading(true)
    setError('')
    try {
      const now = new Date()
      const clockedIn = new Date(activeEntry.clocked_in_at)
      const totalMinutes = Math.floor((now - clockedIn) / 60000)
      const laborCost = (totalMinutes / 60) * (profile.hourly_rate || 0)

      const { error: timeError } = await supabase.from('time_entries').update({
        clocked_out_at: now.toISOString(),
        total_minutes: totalMinutes,
        labor_cost: laborCost
      }).eq('id', activeEntry.id)

      if (timeError) throw timeError

      const { data: project, error: projFetchError } = await supabase.from('projects').select('labor_spent').eq('id', activeEntry.project_id).single()
      if (projFetchError) throw projFetchError

      const { error: projUpdateError } = await supabase.from('projects').update({
        labor_spent: (project?.labor_spent || 0) + laborCost
      }).eq('id', activeEntry.project_id)

      if (projUpdateError) throw projUpdateError

      setActiveEntry(null)
      setTimer(0)
      setToast('Clocked out ✓')
    } catch (e) {
      setError('Clock-out failed. Try again.')
    }
    setLoading(false)
  }

  const formatTimerDisplay = (seconds) => {
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
        {error && <div className="alert-danger" style={{ marginBottom: '12px' }}>{error}</div>}
        {activeTab === 'clock' && (
          <div>
            <div className="card" style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '13px', color: '#888', marginBottom: '4px' }}>{activeEntry ? 'Currently clocked in' : 'Not clocked in'}</p>
              <div className="timer-display">{formatTimerDisplay(timer)}</div>
              {!activeEntry && (
                <div className="input-group" style={{ marginBottom: '12px' }}>
                  <label>Select Job</label>
                  <select value={selectedProject} onChange={e => { setSelectedProject(e.target.value); setError('') }}>
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
            {projects.length === 0 && !activeEntry && (
              <div className="empty-state"><p>No jobs assigned yet. Ask your boss to assign you to a job.</p></div>
            )}
          </div>
        )}
        {activeTab === 'schedule' && (
          <div>
            {schedule.length === 0
              ? <div className="empty-state"><p>No upcoming schedule</p></div>
              : schedule.map(entry => (
                <div key={entry.id} className="card">
                  <p className="schedule-day">{new Date(entry.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                  <h3>{entry.projects?.name}</h3>
                  <p>{entry.task_description}</p>
                  {entry.start_time && <p style={{ fontSize: '12px', color: '#E07B2A', marginTop: '4px', fontWeight: '600' }}>{entry.start_time} — {entry.end_time}</p>}
                </div>
              ))
            }
          </div>
        )}
      </div>
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          background: '#16A34A', color: 'white', padding: '12px 24px', borderRadius: '24px',
          fontSize: '14px', fontWeight: '600', zIndex: 999, boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}