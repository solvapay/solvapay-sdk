import './globals.css'

import { SiteHeader } from '@/components/site-header'

export const metadata = {
  title: 'Next.js Auth0 Task Board',
  description: 'Auth0 login with a per-user task board built with shadcn/ui and Tailwind.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  )
}
