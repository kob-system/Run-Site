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
      console.error('Profile error:', e)
    }
    setLoading(false)
  }

  if (loading) return <div className="loading">Loading Run-Site...</div>
  if (!session) return <Login />
  if (profile?.role === 'worker') return <WorkerDashboard profile={profile} />
  if (profile) return <OwnerDashboard profile={profile} />
  return <div className="loading">Loading...</div>
}