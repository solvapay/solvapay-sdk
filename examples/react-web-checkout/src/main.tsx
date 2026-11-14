import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@solvapay/react/styles.css'
import { App } from './App'

const productRef = import.meta.env.VITE_PRODUCT_REF as string | undefined
if (!productRef) {
  throw new Error('Set VITE_PRODUCT_REF to the product whose plans this page sells.')
}

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

createRoot(root).render(
  <StrictMode>
    <App productRef={productRef} />
  </StrictMode>,
)
