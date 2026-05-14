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
      await supabase.from('profiles').insert({
        id: data.user.id,
        email,
        full_name: name,
        company_name: company,
        role: 'owner'
      })
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
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '20px', color: '#1C2B3A' }}>
          {isSignup ? 'Create Account' : 'Sign In'}
        </h2>
        {error && <div className="alert-danger">{error}</div>}
        <form onSubmit={isSignup ? handleSignup : handleLogin}>
          {isSignup && (
            <>
              <div className="input-group">
                <label>Full Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Josh Smith" required />
              </div>
              <div className="input-group">
                <label>Company Name</label>
                <input type="text" value={company} onChange={e => setCompany(e.target.value)} placeholder="First Class Property Services" required />
              </div>
            </>
          )}
          <div className="input-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" required />
          </div>
          <div className="input-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Loading...' : isSignup ? 'Create Account' : 'Sign In'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '14px', color: '#666' }}>
          {isSignup ? 'Already have an account?' : "Don't have an account?"}
          <button onClick={() => { setIsSignup(!isSignup); setError('') }}
            style={{ background: 'none', border: 'none', color: '#E07B2A', fontWeight: '600', cursor: 'pointer', marginLeft: '6px' }}>
            {isSignup ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  )
}

function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <div className="loading">Loading Run-Site...</div>
  if (!session) return <Login />
  return <div className="loading">Logged in! Dashboard coming soon.</div>
}

export default App