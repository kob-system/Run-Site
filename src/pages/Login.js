import React, { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignup, setIsSignup] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('owner')
  const [ownerEmail, setOwnerEmail] = useState('')

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

    let ownerId = null
    if (role === 'worker') {
      let ownerLookup
      try {
        const resp = await fetch('/api/find-owner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerEmail })
        })
        ownerLookup = await resp.json()
      } catch (err) {
        setError("Couldn't reach the server. Check your connection and try again.")
        setLoading(false)
        return
      }
      if (!ownerLookup || !ownerLookup.ownerId) {
        setError("Could not find an owner account with that email. Ask your boss to sign up first.")
        setLoading(false)
        return
      }
      ownerId = ownerLookup.ownerId
    }

    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) { setError(error.message); setLoading(false); return }

    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id,
        email,
        full_name: name,
        company_name: role === 'owner' ? company : null,
        role,
        owner_id: ownerId
      })
      if (profileError) {
        setError('Account created but profile setup failed: ' + profileError.message)
        setLoading(false)
        return
      }
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
              <div className="input-group">
                <label>I am a...</label>
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                  <button type="button" onClick={() => setRole('owner')} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '2px solid ' + (role === 'owner' ? '#E07B2A' : '#ddd'), background: role === 'owner' ? '#FFF4ED' : 'white', color: role === 'owner' ? '#E07B2A' : '#666', fontWeight: '600', cursor: 'pointer' }}>Contractor / Owner</button>
                  <button type="button" onClick={() => setRole('worker')} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '2px solid ' + (role === 'worker' ? '#E07B2A' : '#ddd'), background: role === 'worker' ? '#FFF4ED' : 'white', color: role === 'worker' ? '#E07B2A' : '#666', fontWeight: '600', cursor: 'pointer' }}>Worker</button>
                </div>
              </div>
              <div className="input-group"><label>Full Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Josh Smith" required /></div>
              {role === 'owner' && (
                <div className="input-group"><label>Company Name</label><input type="text" value={company} onChange={e => setCompany(e.target.value)} placeholder="First Class Property Services" required /></div>
              )}
              {role === 'worker' && (
                <div className="input-group"><label>Your Boss's Email</label><input type="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="boss@email.com" required /></div>
              )}
            </>
          )}
          <div className="input-group"><label>Your Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" required /></div>
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