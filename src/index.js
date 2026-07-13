import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

// Top-level boundary: App.js's own body (auth wiring, the billing gate, the
// loading branches) renders OUTSIDE the per-screen <Screen> boundaries, so an
// error there would otherwise white-screen the entire paid app with no recovery
// UI. Wrapping <App/> guarantees a caught error always shows the fallback.
const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)

// Register the service worker so the app shell loads offline on job sites.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch((err) => {
      console.error('Service worker registration failed:', err)
    })
  })
}
