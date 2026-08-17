import React from 'react'
import { reportError } from '../utils/reportError'

// App-wide error boundary. A single render error anywhere below this used to
// white-screen the whole paid app; now it shows a clean recovery screen with a
// Reload instead — and, since 2026-08-17, it also tells JP it happened.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Render error caught by ErrorBoundary:', error, info)
    // Tell JP. Fire-and-forget and internally incapable of throwing — a
    // reporter that can fail here would turn a recoverable screen into a loop.
    reportError('react-render', error, {
      component: String((info && info.componentStack) || '').trim().split('\n')[0] || '',
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="loading recovery">
          <p>Something went wrong.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 12, padding: '10px 20px', fontSize: 16, cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
