import React, { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import Login from './pages/Login'
import OwnerDashboard from './pages/OwnerDashboard'
import WorkerDashboard from './pages/WorkerDashboard'
import './App.css'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchProfile(session.user)
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchProfile = async (user) => {
    try {
      let { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()

      // No profile row yet. If this account signed up with metadata (the
      // email-confirmation flow defers profile creation to first sign-in),
      // create it now from that metadata. A genuinely orphaned session with
      // no metadata falls through to the recovery screen in render.
      if (!data) {
        const md = user.user_metadata || {}
        if (md.role) {
          await supabase.from('profiles').insert({
            id: user.id,
            email: user.email,
            full_name: md.full_name || '',
            company_name: md.role === 'owner' ? (md.company_name || null) : null,
            role: md.role,
            owner_id: md.owner_id || null
          })
          const res = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
          data = res.data
        }
      }
      setProfile(data)
    } catch (e) {
      console.error('Profile error:', e)
    }
    setLoading(false)
  }

  if (loading) return <div className="loading">Loading Run-Site...</div>
  if (!session) return <Login />
  if (profile?.role === 'worker') return <WorkerDashboard profile={profile} />
  if (profile) return <OwnerDashboard profile={profile} />
  // Session exists but no profile loaded — e.g. an orphaned session after a DB
  // reset, or a failed/incomplete signup. This used to dead-end on a permanent
  // "Loading..." with no escape. Show a recovery screen that sends them back to
  // the login screen instead.
  return (
    <div className="loading">
      <p>We couldn't load your account.</p>
      <button
        onClick={() => supabase.auth.signOut()}
        style={{ marginTop: 12, padding: '10px 20px', fontSize: 16, cursor: 'pointer' }}
      >
        Back to login
      </button>
    </div>
  )
}