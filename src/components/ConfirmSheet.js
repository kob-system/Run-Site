import React from 'react'

// Small styled confirm sheet that replaces native window.confirm() so the app
// keeps its look on mobile. Controlled: parent owns `open` and the outcome via
// onConfirm/onCancel. Tapping the backdrop or Cancel dismisses (same as hitting
// Cancel in a native confirm). Renders nothing when closed.
export default function ConfirmSheet({ open, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <p style={{ fontSize: '15px', color: '#1C2B3A', marginBottom: '20px', lineHeight: '1.5' }}>{message}</p>
        <button className="btn-primary" onClick={onConfirm}>{confirmLabel}</button>
        <button className="btn-secondary" onClick={onCancel}>{cancelLabel}</button>
      </div>
    </div>
  )
}
