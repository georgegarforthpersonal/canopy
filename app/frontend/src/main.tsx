import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'
import { initSentry } from './services/sentry'
import { ORG_SLUG } from './services/api'

initSentry(ORG_SLUG)

const errorFallback = (
  <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
    <h2>Something went wrong</h2>
    <p>The error has been reported. Please reload the page to continue.</p>
    <button onClick={() => window.location.reload()} style={{ padding: '0.5rem 1.5rem', cursor: 'pointer' }}>
      Reload
    </button>
  </div>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={errorFallback}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
