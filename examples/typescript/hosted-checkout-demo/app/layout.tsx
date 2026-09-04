import { ClientLayout } from './components/ClientLayout'
import './globals.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>SolvaPay Hosted Checkout Demo</title>
        <meta name="description" content="Hosted checkout purchase demo" />
      </head>
      <body className="font-sans">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  )
}
