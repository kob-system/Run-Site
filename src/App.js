import React, { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

const Login = React.lazy(() => import('./pages/Login'))
const OwnerDashboard = React.lazy(() => import('./pages/OwnerDashboard'))
const WorkerDashboard = React.lazy(() => import('./pages/WorkerDashboard'))

function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        fetchProfile(session.user.id)
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchProfile = async (userId) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      setProfile(data)
    } catch (e) {
      console.log('Profile error:', e)
    }
    setLoading(false)
  }

  if (loading) {
    return <div className="loading">Loading Run-Site...</div>
  }

  if (!session) {
    return (
      <React.Suspense fallback={<div className="loading">Loading...</div>}>
        <Login />
      </React.Suspense>
    )
  }

  if (profile && profile.role === 'worker') {
    return (
      <React.Suspense fallback={<div className="loading">Loading...</div>}>
        <WorkerDashboard profile={profile} />
      </React.Suspense>
    )
  }

  if (profile) {
    return (
      <React.Suspense fallback={<div className="loading">Loading...</div>}>
        <OwnerDashboard profile={profile} />
      </React.Suspense>
    )
  }

  return <div className="loading">Loading Run-Site...</div>
}

export default App