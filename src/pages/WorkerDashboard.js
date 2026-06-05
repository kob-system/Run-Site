import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { formatTime } from '../utils/formatTime'

const OFFLINE_KEY = 'runsite_offline_entry'
const MAX_RETRIES = 3

// Stable client-generated id so a retried/duplicated sync can never create a
// second row (the DB has a unique constraint on client_id; see the migration).
function newId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID() } catch (e) {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

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
  const [editError, setEditError] = useState('')
  const [toast, setToast] = useState('')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [syncRetries, setSyncRetries] = useState(0)
  const [showEditOffline, setShowEditOffline] = useState(false)
  const [editClockIn, setEditClockIn] = useState('')
  const [editClockOut, setEditClockOut] = useState('')
  const [history, setHistory] = useState([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const [clockReady, setClockReady] = useState(false)
  const [statusError, setStatusError] = useState('')

  // Refs so the sync lock / retry timer / mounted check are synchronous and not
  // subject to stale-closure bugs the way React state is.
  const syncingRef = useRef(false)
  const retryTimerRef = useRef(null)
  const mountedRef = useRef(true)
  const toastTimerRef = useRef(null)
  const retryCountRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

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

  // Load any saved offline entry on mount.
  useEffect(() => {
    const saved = getOfflineEntry()
    if (saved) setOfflineEntry(saved)
  }, [])

  useEffect(() => {
    fetchAssignedProjects()
    fetchSchedule()
    fetchHistory()   // populate the "This week" summary up front
  }, [])

  // One assigned job? Always pin selection to it so a reassignment is reflected.
  // If the selected job is no longer assigned, clear the stale selection.
  useEffect(() => {
    if (projects.length === 1) {
      setSelectedProject(projects[0].id)
    } else if (selectedProject && !projects.some(p => p.id === selectedProject)) {
      setSelectedProject('')
    }
  }, [projects, selectedProject])

  // Verify clock-in status on load AND whenever connectivity returns, so an
  // offline-at-launch worker isn't permanently gated out of clocking in. Also
  // re-fetch jobs/schedule/history on reconnect so a worker who launched offline
  // isn't stranded on "No jobs assigned" / a stale summary until a full reload.
  useEffect(() => {
    if (isOnline) {
      checkActiveEntry()
      fetchAssignedProjects()
      fetchSchedule()
      fetchHistory()
    }
  }, [isOnline])

  // Guard sign-out: if hours are saved on this phone but not yet synced,
  // confirm before logging out so a worker can't accidentally lose them.
  const handleSignOut = () => {
    if (offlineEntry && !window.confirm("You have hours saved on this phone that haven't synced yet. Sign out anyway?")) return
    supabase.auth.signOut()
  }

  const showToast = (msg) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => { if (mountedRef.current) setToast('') }, 3000)
  }

  // Fire-and-forget owner notification. Worker name, owner, and job name are all
  // resolved SERVER-SIDE from the authenticated token + projectId — nothing
  // user-controlled is trusted — so this can't be spoofed/injected.
  const notifyOwner = async (action, timestamp, projectId) => {
    if (!profile.owner_id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      await fetch('/api/notify-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ projectId, action, timestamp })
      })
    } catch (e) { /* notifications are best-effort; never block clock in/out */ }
  }

  const attemptSync = useCallback(async () => {
    if (syncingRef.current) return                                  // an attempt is already in flight
    if (!navigator.onLine) { if (mountedRef.current) setSyncing(false); return }
    if (!getOfflineEntry()) return
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null }

    syncingRef.current = true
    if (mountedRef.current) setSyncing(true)
    let last = null
    try {
      // localStorage is the single source of truth for the pending shift. Sync
      // whatever is stored NOW; if it changes mid-sync (e.g. a clock-out arrives
      // while the clock-in is uploading), loop and sync the newer version too.
      // Clear only once the stored entry stops changing, so a concurrent
      // clock-out is never dropped. upsert(client_id) makes every write idempotent.
      for (;;) {
        if (!navigator.onLine) break
        const cur = getOfflineEntry()
        if (!cur) break
        const { data, error } = await supabase.from('time_entries').upsert({
          client_id: cur.client_id,
          project_id: cur.project_id,
          worker_id: profile.id,
          clocked_in_at: cur.clocked_in_at,
          gps_lat: cur.gps_lat,
          gps_lng: cur.gps_lng,
          clocked_out_at: cur.clocked_out_at || null,
          total_minutes: cur.clocked_out_at ? cur.total_minutes : null,
          labor_cost: cur.clocked_out_at ? cur.labor_cost : null
        }, { onConflict: 'client_id' }).select().single()
        if (error) throw error
        last = { entry: cur, data }
        const after = getOfflineEntry()
        if (after && JSON.stringify(after) !== JSON.stringify(cur)) continue   // newer data arrived → sync it too
        clearOfflineEntry()
        break
      }

      retryCountRef.current = 0
      if (last && mountedRef.current) {
        setOfflineEntry(null)
        if (last.entry.clocked_out_at) setActiveEntry(null)
        else if (last.data) setActiveEntry(last.data)
        setSyncRetries(0)
        showToast('Synced ✓')
        notifyOwner('in', last.entry.clocked_in_at, last.entry.project_id)
        if (last.entry.clocked_out_at) notifyOwner('out', last.entry.clocked_out_at, last.entry.project_id)
      }
      if (mountedRef.current) setSyncing(false)
    } catch (e) {
      if (retryCountRef.current < MAX_RETRIES - 1 && navigator.onLine) {
        const n = retryCountRef.current
        retryCountRef.current = n + 1
        if (mountedRef.current) setSyncRetries(n + 1)
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null
          if (mountedRef.current) attemptSync()
        }, [5000, 30000, 120000][n] || 120000)
        // keep the "Syncing…" indicator on while a retry is pending
      } else {
        retryCountRef.current = 0
        if (mountedRef.current) {
          setError('Sync failed. Tap "Retry Sync" when you have signal — your hours are saved on this phone.')
          setSyncRetries(0)
          setSyncing(false)
        }
      }
    } finally {
      syncingRef.current = false
    }
  }, [profile])

  // Drive sync off the DATA, not a connectivity transition: whenever we're
  // online and have a pending entry, try to sync it. This also auto-syncs an
  // entry that was already in localStorage at app launch. Coalesced by syncingRef.
  useEffect(() => {
    if (isOnline && offlineEntry) attemptSync()
  }, [isOnline, offlineEntry, attemptSync])

  // Timer — runs off whichever entry is active. Only ticks while the clock tab
  // is showing (and the page is visible) to save battery; elapsed is always
  // recomputed from clocked_in_at, so the display is correct the instant the
  // worker returns to the clock tab — nothing drifts while it's paused.
  useEffect(() => {
    const entry = activeEntry || offlineEntry
    if (!entry) return
    const tick = () => {
      const diff = Math.floor((Date.now() - new Date(entry.clocked_in_at).getTime()) / 1000)
      setTimer(diff)
    }
    tick()   // recompute immediately so returning to the tab shows the right time at once
    if (activeTab !== 'clock' || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
      return
    }
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [activeEntry, offlineEntry, activeTab])

  const fetchHistory = async () => {
    setHistoryError('')
    try {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const { data, error } = await supabase
        .from('time_entries')
        .select('*, projects(name)')
        .eq('worker_id', profile.id)
        .gte('clocked_in_at', thirtyDaysAgo.toISOString())
        .order('clocked_in_at', { ascending: false })
      if (error) throw error
      setHistory(data || [])
      setHistoryLoaded(true)
    } catch (e) {
      setHistoryError("Couldn't load your history. Check your connection and try again.")
    }
  }

  const fetchAssignedProjects = async () => {
    try {
      const { data: assignments, error } = await supabase.from('project_workers').select('project_id').eq('worker_id', profile.id)
      if (error) throw error
      if (assignments?.length) {
        const ids = assignments.map(a => a.project_id)
        const { data, error: projError } = await supabase.from('projects').select('*').in('id', ids).neq('stage', 'end')
        if (projError) throw projError
        setProjects(data || [])
      } else {
        setProjects([])
      }
    } catch (e) {
      setError('Could not load jobs. Check your connection.')
    }
  }

  const fetchSchedule = async () => {
    setScheduleError('')
    try {
      const { data, error } = await supabase.from('schedule_entries').select('*, projects(name)').eq('worker_id', profile.id).gte('scheduled_date', new Date().toISOString().split('T')[0]).order('scheduled_date', { ascending: true })
      if (error) throw error
      setSchedule(data || [])
    } catch (e) {
      setScheduleError("Couldn't load your schedule. Check your connection.")
    }
  }

  const checkActiveEntry = async () => {
    setStatusError('')
    try {
      const { data, error } = await supabase.from('time_entries').select('*').eq('worker_id', profile.id).is('clocked_out_at', null).maybeSingle()
      if (error) throw error
      if (data) setActiveEntry(data)
      setClockReady(true)
    } catch (e) {
      // Do NOT silently fall through to "not clocked in" — that would let a
      // worker clock in twice. Block clock-in until we can confirm status.
      setStatusError("Couldn't verify your clock-in status.")
      setClockReady(false)
    }
  }

  const clockIn = async () => {
    if (!selectedProject) return setError('Select a job first')
    setLoading(true)
    setError('')

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
    const jobName = projects.find(p => p.id === selectedProject)?.name || ''
    const entry = { client_id: newId(), project_id: selectedProject, clocked_in_at: clockInTime, gps_lat: gpsLat, gps_lng: gpsLng, job_name: jobName }

    if (!isOnline) {
      saveOfflineEntry(entry)
      setOfflineEntry(entry)
      showToast('📶 Saved offline — will sync when connected')
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase.from('time_entries').insert({
        client_id: entry.client_id,
        project_id: selectedProject,
        worker_id: profile.id,
        clocked_in_at: clockInTime,
        gps_lat: gpsLat,
        gps_lng: gpsLng
      }).select().single()

      if (error) throw error
      setActiveEntry(data)
      notifyOwner('in', clockInTime, selectedProject)
      showToast('Clocked in ✓')
    } catch (e) {
      // Online but the write failed — keep it locally and let the sync effect retry.
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
      // Build the completed entry and KEEP it in localStorage until the server
      // confirms the insert. The sync effect (driven by offlineEntry changing)
      // picks it up; attemptSync clears local storage only on success.
      const fullEntry = { ...offlineEntry, clocked_out_at: now.toISOString(), total_minutes: totalMinutes, labor_cost: laborCost }
      saveOfflineEntry(fullEntry)
      setOfflineEntry(fullEntry)
      setTimer(0)
      showToast(isOnline ? 'Clocked out — syncing…' : '📶 Clocked out — will sync when connected')
      setLoading(false)
      return
    }

    // Online clock-in being clocked out. If we're offline (or the update fails),
    // persist the completed shift keyed by the row's client_id so the sync loop
    // finishes it via upsert — never silently fail the clock-out and lose hours.
    const deferClockOut = () => {
      const full = {
        client_id: activeEntry.client_id,
        project_id: activeEntry.project_id,
        clocked_in_at: activeEntry.clocked_in_at,
        gps_lat: activeEntry.gps_lat,
        gps_lng: activeEntry.gps_lng,
        clocked_out_at: now.toISOString(),
        total_minutes: totalMinutes,
        labor_cost: laborCost
      }
      saveOfflineEntry(full)
      setOfflineEntry(full)
      setActiveEntry(null)
      setTimer(0)
    }

    if (!isOnline) {
      if (activeEntry.client_id) { deferClockOut(); showToast('📶 Clocked out — will sync when connected') }
      else setError("You're offline — reconnect to clock out.")
      setLoading(false)
      return
    }

    try {
      const { error: timeError } = await supabase.from('time_entries').update({
        clocked_out_at: now.toISOString(),
        total_minutes: totalMinutes,
        labor_cost: laborCost
      }).eq('id', activeEntry.id)
      if (timeError) throw timeError

      notifyOwner('out', now.toISOString(), activeEntry.project_id)
      setActiveEntry(null)
      setTimer(0)
      showToast('Clocked out ✓')
    } catch (e) {
      // Online but the update failed — defer offline if we can dedup it, else retry.
      if (activeEntry.client_id) { deferClockOut(); showToast('Clocked out — syncing…') }
      else setError('Clock-out failed. Try again.')
    }
    setLoading(false)
  }

  const saveOfflineEdit = () => {
    setEditError('')
    if (!editClockIn) return setEditError('Clock-in time is required')
    const clockInDate = new Date(editClockIn)
    const nowMs = Date.now()
    if (clockInDate.getTime() > nowMs) return setEditError("Clock-in time can't be in the future.")
    const updated = { ...offlineEntry, clocked_in_at: clockInDate.toISOString() }
    if (editClockOut) {
      const clockOutDate = new Date(editClockOut)
      if (clockOutDate.getTime() > nowMs) return setEditError("Clock-out time can't be in the future.")
      if (clockOutDate <= clockInDate) return setEditError('Clock-out must be after clock-in')
      if (clockOutDate - clockInDate > 24 * 60 * 60 * 1000) return setEditError('That shift is over 24 hours — please check the times.')
      const totalMinutes = Math.floor((clockOutDate - clockInDate) / 60000)
      const laborCost = (totalMinutes / 60) * (profile.hourly_rate || 0)
      updated.clocked_out_at = clockOutDate.toISOString()
      updated.total_minutes = totalMinutes
      updated.labor_cost = laborCost
    }
    saveOfflineEntry(updated)
    setOfflineEntry(updated)   // sync effect will pick it up if online
    setShowEditOffline(false)
    setEditClockIn('')
    setEditClockOut('')
    if (!isOnline) showToast('Updated — will sync when connected')
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

  // Turn an "HH:MM" / "HH:MM:SS" clock string into a 12-hour am/pm label
  // (e.g. "13:00:00" -> "1:00 PM"). Returns '' for null/empty/malformed input.
  const formatScheduleTime = (t) => {
    if (!t || typeof t !== 'string') return ''
    const parts = t.split(':')
    const h = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10)
    if (isNaN(h) || isNaN(m)) return ''
    const ampm = h < 12 ? 'AM' : 'PM'
    const hour12 = h % 12 === 0 ? 12 : h % 12
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  const currentEntry = activeEntry || offlineEntry

  // This week's hours + pay from loaded history, so the worker can always see
  // what they've banked. Week starts Sunday, local time. Includes the live
  // currently-active shift (elapsed so far) so the total isn't understated.
  const weekStats = (() => {
    const now = new Date()
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
    let mins = 0, pay = 0
    history.forEach(e => {
      if (e.clocked_out_at && new Date(e.clocked_in_at) >= weekStart) {
        mins += e.total_minutes || 0
        pay += e.labor_cost || 0
      }
    })
    // Add the in-progress shift's elapsed time/pay (it's not in `history`, which
    // only contains completed entries, and a fresh clock-in may not be there yet).
    if (currentEntry && currentEntry.clocked_in_at && new Date(currentEntry.clocked_in_at) >= weekStart) {
      const liveMins = Math.max(0, Math.floor((Date.now() - new Date(currentEntry.clocked_in_at)) / 60000))
      mins += liveMins
      pay += (liveMins / 60) * (profile.hourly_rate || 0)
    }
    return { mins, pay }
  })()

  const isOfflineMode = !!offlineEntry && !activeEntry

  return (
    <div>
      <div className="topbar">
        <h1>RUN-SITE</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isOnline && <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.2)', padding: '3px 8px', borderRadius: '12px' }}>📶 Offline</span>}
          <button onClick={handleSignOut}>Sign Out</button>
        </div>
      </div>

      <div className="tabs" style={{ margin: '16px 16px 0' }}>
        <button className={'tab ' + (activeTab === 'clock' ? 'active' : '')} onClick={() => setActiveTab('clock')}>Clock In/Out</button>
        <button className={'tab ' + (activeTab === 'schedule' ? 'active' : '')} onClick={() => setActiveTab('schedule')}>My Schedule</button>
        <button className={'tab ' + (activeTab === 'history' ? 'active' : '')} onClick={() => setActiveTab('history')}>History</button>
      </div>

      <div className="page">
        {error && <div className="alert-danger" style={{ marginBottom: '12px' }}>{error} {error.includes('Sync failed') && <button onClick={() => attemptSync()} style={{ background: 'none', border: 'none', color: 'white', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }}>Retry Sync</button>}</div>}

        {syncing && <div style={{ textAlign: 'center', fontSize: '13px', color: '#E07B2A', marginBottom: '8px' }}>⏳ Syncing{syncRetries > 0 ? ` (attempt ${syncRetries + 1})` : ''}...</div>}

        {activeTab === 'clock' && (
          <div>
            <div className="card" style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '4px' }}>
                {currentEntry
                  ? isOfflineMode ? '📶 Clocked in (offline)' : 'Currently clocked in'
                  : 'Not clocked in'}
              </p>
              <p style={{ fontSize: '12px', fontWeight: '600', color: currentEntry ? '#16A34A' : '#9CA3AF', marginBottom: '4px' }}>
                {currentEntry ? '📍 GPS on — stamping your start/stop' : '📍 GPS off'}
              </p>
              {currentEntry
                ? <div className="timer-display">{formatTimerDisplay(timer)}</div>
                : <p style={{ fontSize: '15px', color: '#6B7280', margin: '10px 0 16px' }}>Tap the big button below when you get to the job.</p>}

              {!currentEntry && (
                projects.length === 1 ? (
                  <div style={{ marginBottom: '14px' }}>
                    <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '2px' }}>Your job</p>
                    <p style={{ fontSize: '18px', fontWeight: '700', color: '#1C2B3A' }}>📍 {projects[0].name}</p>
                  </div>
                ) : (
                  <div className="input-group" style={{ marginBottom: '12px' }}>
                    <label htmlFor="select-job">Select Job</label>
                    <select id="select-job" value={selectedProject} onChange={e => { setSelectedProject(e.target.value); setError('') }}>
                      <option value="">-- Choose a job --</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                )
              )}

              {statusError && !currentEntry && (
                <div className="alert-warning" style={{ marginBottom: '12px' }}>
                  {statusError} <button onClick={checkActiveEntry} style={{ background: 'none', border: 'none', color: '#92400e', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }}>Retry</button>
                </div>
              )}

              {currentEntry ? (
                <div>
                  <button className="btn-danger" onClick={clockOut} disabled={loading} style={{ marginBottom: '8px' }}>
                    {loading ? 'Clocking Out...' : 'Clock Out'}
                  </button>
                  {isOfflineMode && (
                    <button onClick={() => { setEditError(''); setShowEditOffline(true); setEditClockIn(toLocalDatetimeInput(offlineEntry.clocked_in_at)); setEditClockOut('') }} style={{ background: 'none', border: 'none', color: '#E07B2A', fontSize: '14px', cursor: 'pointer', display: 'block', margin: '0 auto', minHeight: '44px' }}>
                      ✏️ Edit clock-in time
                    </button>
                  )}
                </div>
              ) : (
                <button className="btn-primary" onClick={clockIn} disabled={loading || (isOnline && !clockReady)} style={{ fontSize: '18px', padding: '18px', minHeight: '60px' }}>
                  {loading ? 'Clocking In...' : (isOnline && !clockReady) ? 'Checking…' : 'Clock In'}
                </button>
              )}
              <p style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '14px', lineHeight: '1.5', borderTop: '1px solid #f0f0f0', paddingTop: '12px' }}>
                🔒 Your location only stamps your start and stop so your hours can never be disputed. GPS is off when you're clocked out.
              </p>
            </div>

            {projects.length === 0 && !currentEntry && clockReady && (
              <div className="empty-state"><p>No jobs assigned yet. Ask your boss to assign you to a job.</p></div>
            )}
          </div>
        )}

        {activeTab === 'schedule' && (
          <div>
            {scheduleError
              ? <div className="alert-danger">{scheduleError}</div>
              : schedule.length === 0
                ? <div className="empty-state"><p>No upcoming schedule</p></div>
                : schedule.map(entry => (
                  <div key={entry.id} className="card">
                    <p className="schedule-day">{new Date(entry.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                    <h3>{entry.projects?.name}</h3>
                    <p>{entry.task_description}</p>
                    {entry.start_time && <p style={{ fontSize: '12px', color: '#E07B2A', marginTop: '4px', fontWeight: '600' }}>{formatScheduleTime(entry.start_time)}{entry.end_time ? ` — ${formatScheduleTime(entry.end_time)}` : ''}</p>}
                  </div>
                ))
            }
          </div>
        )}

        {activeTab === 'history' && (
          <div>
            <div className="card" style={{ background: '#1C2B3A', color: 'white', textAlign: 'center', marginBottom: '12px' }}>
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px' }}>This week</p>
              <p style={{ fontSize: '28px', fontWeight: '800' }}>{historyLoaded ? formatTime(weekStats.mins) : '—'}</p>
              {profile.hourly_rate ? <p style={{ fontSize: '14px', color: '#16A34A', fontWeight: '700' }}>≈ {historyLoaded ? `$${weekStats.pay.toFixed(2)}` : '—'} this week</p> : null}
            </div>
            {historyError
              ? <div className="alert-danger">{historyError} <button onClick={fetchHistory} style={{ background: 'none', border: 'none', color: 'white', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }}>Retry</button></div>
              : history.length === 0
                ? <div className="empty-state"><p>No time entries in the last 30 days</p></div>
                : history.map(entry => {
                    const clockIn = new Date(entry.clocked_in_at)
                    const clockOut = entry.clocked_out_at ? new Date(entry.clocked_out_at) : null
                    return (
                      <div key={entry.id} className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <p style={{ fontSize: '11px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                              {clockIn.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            </p>
                            <h3>{entry.projects?.name || 'Unknown Job'}</h3>
                            <p style={{ fontSize: '13px', color: '#4B5563', marginTop: '4px' }}>
                              In: {clockIn.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                              {clockOut ? ` — Out: ${clockOut.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}` : ''}
                            </p>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            {entry.clocked_out_at
                              ? <p style={{ fontWeight: '700', fontSize: '16px', color: '#1C2B3A' }}>{formatTime(entry.total_minutes || 0)}</p>
                              : <p style={{ fontSize: '12px', color: '#E07B2A', fontWeight: '600' }}>Active</p>
                            }
                          </div>
                        </div>
                      </div>
                    )
                  })
            }
          </div>
        )}
      </div>

      {/* EDIT OFFLINE ENTRY MODAL */}
      {showEditOffline && (
        <div className="modal-overlay" onClick={() => { setShowEditOffline(false); setEditError(''); setEditClockOut('') }}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h2>Edit Clock-In</h2>
            <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '16px' }}>Saved offline. You can correct the time or add a clock-out if needed.</p>
            <div className="input-group">
              <label htmlFor="edit-clock-in">Clock-In Time</label>
              <input id="edit-clock-in" type="datetime-local" value={editClockIn} onChange={e => setEditClockIn(e.target.value)} />
            </div>
            <div className="input-group">
              <label htmlFor="edit-clock-out">Clock-Out Time (optional)</label>
              <input id="edit-clock-out" type="datetime-local" value={editClockOut} onChange={e => setEditClockOut(e.target.value)} />
            </div>
            {editError && <p style={{ color: '#DC2626', fontSize: '13px', marginBottom: '8px' }}>{editError}</p>}
            <button className="btn-primary" onClick={saveOfflineEdit}>Save</button>
            <button className="btn-secondary" onClick={() => { setShowEditOffline(false); setEditError(''); setEditClockOut('') }}>Cancel</button>
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
