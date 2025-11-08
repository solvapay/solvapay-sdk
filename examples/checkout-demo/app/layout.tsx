import { ClientLayout } from './components/ClientLayout'
import './globals.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>SolvaPay Checkout Demo</title>
        <meta name="description" content="Minimal subscription checkout" />
      </head>
      <body className="font-sans">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  )
}
