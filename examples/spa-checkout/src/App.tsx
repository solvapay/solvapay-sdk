import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Providers } from './providers'
import { Home } from './routes/Home'
import { Login } from './routes/Login'
import { Checkout } from './routes/Checkout'
import { Dashboard } from './routes/Dashboard'

export function App() {
  return (
    <BrowserRouter>
      <Providers>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </Providers>
    </BrowserRouter>
  )
}
