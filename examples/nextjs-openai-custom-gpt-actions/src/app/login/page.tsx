'use client'

import { Auth } from '@/app/components/Auth'
import { Suspense } from 'react'

function LoginContent() {
  return <Auth initialView="signin" />
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Suspense fallback={<div className="flex justify-center items-center min-h-screen">Loading...</div>}>
        <LoginContent />
      </Suspense>
    </div>
  )
}
