import React, { useEffect } from 'react'

export default function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [message, onClose])

  if (!message) return null

  return (
    <div style={{
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      background: type === 'success' ? '#16A34A' : '#DC2626',
      color: 'white', padding: '12px 24px', borderRadius: '24px',
      fontSize: '14px', fontWeight: '600', zIndex: 999,
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)', whiteSpace: 'nowrap'
    }}>
      {message}
    </div>
  )
}