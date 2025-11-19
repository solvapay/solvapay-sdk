'use client'

import { Auth } from '@/app/components/Auth'
import { Suspense } from 'react'

function SignupContent() {
  return <Auth initialView="signup" />
}

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Suspense fallback={<div className="flex justify-center items-center min-h-screen">Loading...</div>}>
        <SignupContent />
      </Suspense>
    </div>
  )
}

