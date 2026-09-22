import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { FocusProvider } from './components/focus/FocusProvider'
import { Providers } from './src/lib/Providers'
import '@solvapay/react/styles.css'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Could not find root element to mount to')
}

const root = ReactDOM.createRoot(rootElement)
root.render(
  <React.StrictMode>
    <Providers>
      <FocusProvider>
        <App />
      </FocusProvider>
    </Providers>
  </React.StrictMode>,
)
