import React from 'react'

// App-wide error boundary. A single render error anywhere below this used to
// white-screen the whole paid app; now it shows a clean recovery screen with a
// Reload instead. Structured so telemetry could report the error later — the
// componentDidCatch hook is the hook point.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // Best-effort log. A telemetry sink (Sentry/LogRocket/etc.) can hook in here
    // later without touching the render path.
    console.error('Render error caught by ErrorBoundary:', error, info)
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
