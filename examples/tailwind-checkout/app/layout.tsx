import { Providers } from './providers'
import './globals.css'

export const metadata = {
  title: 'SolvaPay Tailwind Checkout',
  description: 'Primitive-only checkout composed with Tailwind v4 data-[state=X]: variants.',
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
