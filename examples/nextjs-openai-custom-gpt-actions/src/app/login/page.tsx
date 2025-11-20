import { Auth } from '@/app/components/Auth'
import { Suspense } from 'react'

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Suspense fallback={<div className="flex justify-center items-center min-h-screen">Loading...</div>}>
        <Auth initialView="signin" />
      </Suspense>
    </div>
  )
}
