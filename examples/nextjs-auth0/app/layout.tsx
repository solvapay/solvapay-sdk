import '@solvapay/react/styles.css'
import './globals.css'

import { SiteHeader } from '@/components/site-header'
import { SolvaPayClientProvider } from '@/components/solvapay-provider'

export const metadata = {
  title: 'Next.js Auth0 Task Board',
  description: 'Auth0 login with a per-user task board built with shadcn/ui and Tailwind.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SolvaPayClientProvider>
          <SiteHeader />
          {children}
        </SolvaPayClientProvider>
      </body>
    </html>
  )
}
