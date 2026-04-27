import { Providers } from './providers'
import './globals.css'

export const metadata = {
  title: 'SolvaPay shadcn/ui Checkout',
  description: 'SolvaPay primitives composed with shadcn/ui via asChild.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
