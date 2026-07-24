import { NextRequest } from 'next/server'
import { disableAutoRecharge, getAutoRecharge, saveAutoRecharge } from '@solvapay/next'

export const GET = (request: NextRequest) => getAutoRecharge(request)

export const PUT = (request: NextRequest) => saveAutoRecharge(request)

export const DELETE = (request: NextRequest) => disableAutoRecharge(request)
