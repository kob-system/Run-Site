import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { formatTime } from '../utils/formatTime'

const OFFLINE_KEY = 'runsite_offline_entry'
const MAX_RETRIES = 3

function saveOfflineEntry(entry) {
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(entry))
}

function getOfflineEntry() {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function clearOfflineEntry() {
  localStorage.removeItem(OFFLINE_KEY)
}

export default function WorkerDashboard({ profile }) {
  const [activeTab, setActiveTab] = useState('clock')
  const [projects, setProjects] = useState([])
  const [activeEntry, setActiveEntry] = useState(null)
  const [offlineEntry, setOfflineEntry] = useState(null)
  const [selectedProject, setSelectedProject] = useState('')
  const [timer, setTimer] = useState(0)
  const [schedule, setSchedule] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [syncRetries, setSyncRetries] = useState(0)
  const [showEditOffline, setShowEditOffline] = useState(false)
  const [editClockIn, setEditClockIn] = useState('')
  const [editClockOut, setEditClockOut] = useState('')
const [history, setHistory] = useState([])

  // Track online/offline status
  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // When coming back online, attempt sync
  useEffect(() => {
    if (isOnline && offlineEntry) {
      attemptSync(offlineEntry)
    }
  }, [isOnline])

  // Load offline entry from localStorage on mount
  useEffect(() => {
    const saved = getOfflineEntry()
    if (saved) setOfflineEntry(saved)
  }, [])

  useEffect(() => {
    fetchAssignedProjects()
    fetchSchedule()
    checkActiveEntry()
  }, [])const fetchHistory = async () => {
  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const { data } = await supabase
      .from('time_entries')
      .select('*, projects(name)')
      .eq('worker_id', profile.id)
      .gte('clocked_in_at', thirtyDaysAgo.toISOString())
      .order('clocked_in_at', { ascending: false })
    setHistory(data || [])
  } catch (e) {}
}

  // Timer — runs off whichever entry is active
  useEffect(() => {
    let interval
    const entry = activeEntry || offlineEntry
    if (entry) {
      interval = setInterval(() => {
        const clockInTime = entry.clocked_in_at
        const diff = Math.floor((Date.now() - new Date(clockInTime).getTime()) / 1000)
        setTimer(diff)
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [activeEntry, offlineEntry])

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const attemptSync = useCallback(async (entry, retryCount = 0) => {
    if (syncing) return
    setSyncing(true)
    try {
      // Get owner profile to send notification
      const { data: ownerProfile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', profile.owner_id)
        .single()

      const { data, error } = await supabase.from('time_entries').insert({
        project_id: entry.project_id,
        worker_id: profile.id,
        clocked_in_at: entry.clocked_in_at,
        gps_lat: entry.gps_lat,
        gps_lng: entry.gps_lng,
        ...(entry.clocked_out_at ? {
          clocked_out_at: entry.clocked_out_at,
          total_minutes: entry.total_minutes,
          labor_cost: entry.labor_cost
        } : {})
      }).select().single()

      if (error) throw error

      // If entry includes a clock-out, update project labor_spent
      if (entry.clocked_out_at && entry.labor_cost) {
        const { data: project } = await supabase.from('projects').select('labor_spent').eq('id', entry.project_id).single()
        await supabase.from('projects').update({
          labor_spent: (project?.labor_spent || 0) + entry.labor_cost
        }).eq('id', entry.project_id)
      }

      // Notify owner
      if (ownerProfile?.email) {
        const jobName = projects.find(p => p.id === entry.project_id)?.name || 'a job'
        fetch('/api/notify-owner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerEmail: ownerProfile.email,
            workerName: profile.full_name,
            jobName,
            action: 'in',
            timestamp: entry.clocked_in_at
          })
        })
      }

      clearOfflineEntry()
      setOfflineEntry(null)
      if (!entry.clocked_out_at) setActiveEntry(data)
      setSyncRetries(0)
      showToast('Synced ✓')
    } catch (e) {
      if (retryCount < MAX_RETRIES) {
        const delay = [5000, 30000, 120000][retryCount]
        setTimeout(() => {
          setSyncRetries(retryCount + 1)
          attemptSync(entry, retryCount + 1)
        }, delay)
      } else {
        setError('Sync failed after 3 attempts. Tap "Retry Sync" when you have signal.')
        setSyncRetries(0)
      }
    }
    setSyncing(false)
  }, [profile, projects, syncing])

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
      const { data } = await supabase.from('schedule_entries').select('*, projects(name)').eq('worker_id', profile.id).gte('scheduled_date', new Date().toISOString().split('T')[0]).order('scheduled_date', { ascending: true })
      setSchedule(data || [])
    } catch (e) {}
  }

  const checkActiveEntry = async () => {
    try {
      const { data } = await supabase.from('time_entries').select('*').eq('worker_id', profile.id).is('clocked_out_at', null).single()
      if (data) setActiveEntry(data)
    } catch (e) {}
  }

  const clockIn = async () => {
    if (!selectedProject) return setError('Select a job first')
    setLoading(true)
    setError('')

    // Get GPS
    let gpsLat = null
    let gpsLng = null
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
      )
      gpsLat = pos.coords.latitude
      gpsLng = pos.coords.longitude
    } catch {}

    const clockInTime = new Date().toISOString()
    const entry = { project_id: selectedProject, clocked_in_at: clockInTime, gps_lat: gpsLat, gps_lng: gpsLng }

    if (!isOnline) {
      // Save offline
      saveOfflineEntry(entry)
      setOfflineEntry(entry)
      showToast('📶 Saved offline — will sync when connected')
      setLoading(false)
      return
    }

    try {
      const { data: ownerProfile } = await supabase.from('profiles').select('email').eq('id', profile.owner_id).single()
      const { data, error } = await supabase.from('time_entries').insert({
        project_id: selectedProject,
        worker_id: profile.id,
        clocked_in_at: clockInTime,
        gps_lat: gpsLat,
        gps_lng: gpsLng
      }).select().single()

      if (error) throw error
      setActiveEntry(data)

      // Notify owner
      if (ownerProfile?.email) {
        const jobName = projects.find(p => p.id === selectedProject)?.name || 'a job'
        fetch('/api/notify-owner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerEmail: ownerProfile.email,
            workerName: profile.full_name,
            jobName,
            action: 'in',
            timestamp: clockInTime
          })
        })
      }
      showToast('Clocked in ✓')
    } catch (e) {
      // Online but Supabase failed — save offline as fallback
      saveOfflineEntry(entry)
      setOfflineEntry(entry)
      showToast('📶 Saved locally — will sync shortly')
    }
    setLoading(false)
  }

  const clockOut = async () => {
    setLoading(true)
    setError('')
    const entry = activeEntry || offlineEntry
    if (!entry) { setLoading(false); return }

    const now = new Date()
    const clockedIn = new Date(entry.clocked_in_at)
    const totalMinutes = Math.floor((now - clockedIn) / 60000)
    const laborCost = (totalMinutes / 60) * (profile.hourly_rate || 0)

    if (offlineEntry && !activeEntry) {
      const fullEntry = { ...offlineEntry, clocked_out_at: now.toISOString(), total_minutes: totalMinutes, labor_cost: laborCost }
      saveOfflineEntry(fullEntry)
      setOfflineEntry(null)
      clearOfflineEntry()
      setTimer(0)
      showToast('📶 Clocked out — will sync when connected')
      setLoading(false)
      // Attempt sync immediately if online
      if (isOnline) attemptSync(fullEntry)
      return
    }

    try {
      const { error: timeError } = await supabase.from('time_entries').update({
        clocked_out_at: now.toISOString(),
        total_minutes: totalMinutes,
        labor_cost: laborCost
      }).eq('id', activeEntry.id)
      if (timeError) throw timeError

      const { data: project } = await supabase.from('projects').select('labor_spent').eq('id', activeEntry.project_id).single()
      await supabase.from('projects').update({
        labor_spent: (project?.labor_spent || 0) + laborCost
      }).eq('id', activeEntry.project_id)

      // Notify owner
      const { data: ownerProfile } = await supabase.from('profiles').select('email').eq('id', profile.owner_id).single()
      if (ownerProfile?.email) {
        const jobName = projects.find(p => p.id === activeEntry.project_id)?.name || 'a job'
        fetch('/api/notify-owner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerEmail: ownerProfile.email,
            workerName: profile.full_name,
            jobName,
            action: 'out',
            timestamp: now.toISOString()
          })
        })
      }

      setActiveEntry(null)
      setTimer(0)
      showToast('Clocked out ✓')
    } catch (e) {
      setError('Clock-out failed. Try again.')
    }
    setLoading(false)
  }

  const saveOfflineEdit = () => {
    if (!editClockIn) return setError('Clock-in time is required')
    const clockInDate = new Date(editClockIn)
    const updated = { ...offlineEntry, clocked_in_at: clockInDate.toISOString() }
    if (editClockOut) {
      const clockOutDate = new Date(editClockOut)
      const totalMinutes = Math.floor((clockOutDate - clockInDate) / 60000)
      const laborCost = (totalMinutes / 60) * (profile.hourly_rate || 0)
      updated.clocked_out_at = clockOutDate.toISOString()
      updated.total_minutes = totalMinutes
      updated.labor_cost = laborCost
    }
    saveOfflineEntry(updated)
    setOfflineEntry(updated)
    setShowEditOffline(false)
    setEditClockIn('')
    setEditClockOut('')
    if (isOnline) attemptSync(updated)
    else showToast('Updated — will sync when connected')
  }

  const formatTimerDisplay = (seconds) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  }

  const toLocalDatetimeInput = (isoString) => {
    if (!isoString) return ''
    const d = new Date(isoString)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const currentEntry = activeEntry || offlineEntry
  const isOfflineMode = !!offlineEntry && !activeEntry

  return (
    <div>
      <div className="topbar">
        <h1>RUN-SITE</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isOnline && <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.2)', padding: '3px 8px', borderRadius: '12px' }}>📶 Offline</span>}
          <button onClick={() => supabase.auth.signOut()}>Sign Out</button>
        </div>
      </div>

      <div className="tabs" style={{ margin: '16px 16px 0' }}>
        <button className={'tab ' + (activeTab === 'clock' ? 'active' : '')} onClick={() => setActiveTab('clock')}>Clock In/Out</button>
        <button className={'tab ' + (activeTab === 'schedule' ? 'active' : '')} onClick={() => setActiveTab('schedule')}>My Schedule</button>
<button className={'tab ' + (activeTab === 'history' ? 'active' : '')} onClick={() => { setActiveTab('history'); fetchHistory() }}>History</button>
      </div>

      <div className="page">
        {error && <div className="alert-danger" style={{ marginBottom: '12px' }}>{error} {error.includes('Sync failed') && <button onClick={() => attemptSync(offlineEntry)} style={{ background: 'none', border: 'none', color: 'white', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }}>Retry Sync</button>}</div>}

        {syncing && <div style={{ textAlign: 'center', fontSize: '13px', color: '#E07B2A', marginBottom: '8px' }}>⏳ Syncing{syncRetries > 0 ? ` (attempt ${syncRetries + 1})` : ''}...</div>}

        {activeTab === 'clock' && (
          <div>
            <div className="card" style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '13px', color: '#888', marginBottom: '4px' }}>
                {currentEntry
                  ? isOfflineMode ? '📶 Clocked in (offline)' : 'Currently clocked in'
                  : 'Not clocked in'}
              </p>
              <div className="timer-display">{formatTimerDisplay(timer)}</div>

              {!currentEntry && (
                <div className="input-group" style={{ marginBottom: '12px' }}>
                  <label>Select Job</label>
                  <select value={selectedProject} onChange={e => { setSelectedProject(e.target.value); setError('') }}>
                    <option value="">-- Choose a job --</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              {currentEntry ? (
                <div>
                  <button className="btn-danger" onClick={clockOut} disabled={loading} style={{ marginBottom: '8px' }}>
                    {loading ? 'Clocking Out...' : 'Clock Out'}
                  </button>
                  {isOfflineMode && (
                    <button onClick={() => { setShowEditOffline(true); setEditClockIn(toLocalDatetimeInput(offlineEntry.clocked_in_at)) }} style={{ background: 'none', border: 'none', color: '#E07B2A', fontSize: '13px', cursor: 'pointer', display: 'block', margin: '0 auto' }}>
                      ✏️ Edit clock-in time
                    </button>
                  )}
                </div>
              ) : (
                <button className="btn-primary" onClick={clockIn} disabled={loading}>
                  {loading ? 'Clocking In...' : 'Clock In'}
                </button>
              )}
            </div>

            {projects.length === 0 && !currentEntry && (
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

      {/* EDIT OFFLINE ENTRY MODAL */}
      {showEditOffline && (
        <div className="modal-overlay" onClick={() => setShowEditOffline(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>Edit Clock-In</h2>
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>Saved offline. You can correct the time or add a clock-out if needed.</p>
            <div className="input-group">
              <label>Clock-In Time</label>
              <input type="datetime-local" value={editClockIn} onChange={e => setEditClockIn(e.target.value)} />
            </div>
            <div className="input-group">
              <label>Clock-Out Time (optional)</label>
              <input type="datetime-local" value={editClockOut} onChange={e => setEditClockOut(e.target.value)} />
            </div>
            {error && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{error}</p>}
            <button className="btn-primary" onClick={saveOfflineEdit}>Save</button>
            <button className="btn-secondary" onClick={() => setShowEditOffline(false)}>Cancel</button>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          background: '#16A34A', color: 'white', padding: '12px 24px', borderRadius: '24px',
          fontSize: '14px', fontWeight: '600', zIndex: 999, boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
        }}>{toast}</div>
      )}
    </div>
  )
}