/**
 * OAuth Storage
 *
 * OAuth storage using Supabase database.
 * Handles storage for:
 * - Authorization codes (short-lived, one-time use)
 * - Refresh tokens (long-lived)
 */

import { createClient } from '@supabase/supabase-js'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  // For backend operations, we prefer the service role key to bypass RLS
  // If not available, fall back to anon key (which requires RLS policies)
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase environment variables not configured')
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Authorization Code Storage
 */
export const authCodes = {
  /**
   * Store an authorization code
   */
  async set(data: {
    code: string
    userId: string
    clientId: string
    redirectUri: string
    scope: string
    expiresAt: Date
  }) {
    const supabase = getSupabaseClient()
    const { error } = await supabase.from('oauth_codes').insert({
      code: data.code,
      user_id: data.userId,
      client_id: data.clientId,
      redirect_uri: data.redirectUri,
      scope: data.scope,
      expires_at: data.expiresAt.toISOString(),
    })

    if (error) {
      console.error('Error storing auth code:', error)
      throw error
    }
  },

  /**
   * Retrieve and delete an authorization code (one-time use)
   */
  async consume(code: string): Promise<{
    userId: string
    clientId: string
    redirectUri: string
    scope: string
    expiresAt: Date
  } | null> {
    const supabase = getSupabaseClient()
    
    // Get the code
    const { data, error } = await supabase
      .from('oauth_codes')
      .select('*')
      .eq('code', code)
      .single()

    if (error || !data) {
      return null
    }

    // Delete immediately (one-time use)
    await supabase.from('oauth_codes').delete().eq('code', code)

    // Check expiration
    if (new Date(data.expires_at) < new Date()) {
      return null
    }

    return {
      userId: data.user_id,
      clientId: data.client_id,
      redirectUri: data.redirect_uri,
      scope: data.scope,
      expiresAt: new Date(data.expires_at),
    }
  }
}

/**
 * Refresh Token Storage
 */
export const refreshTokens = {
  /**
   * Store a refresh token
   */
  async set(data: {
    token: string
    userId: string
    clientId: string
    scope: string
    issuedAt: Date
    expiresAt: Date
  }) {
    const supabase = getSupabaseClient()
    const { error } = await supabase.from('oauth_refresh_tokens').insert({
      token: data.token,
      user_id: data.userId,
      client_id: data.clientId,
      scope: data.scope,
      issued_at: data.issuedAt.toISOString(),
      expires_at: data.expiresAt.toISOString(),
    })

    if (error) {
      console.error('Error storing refresh token:', error)
      throw error
    }
  },

  /**
   * Get refresh token data
   */
  async get(token: string): Promise<{
    userId: string
    clientId: string
    scope: string
    issuedAt: Date
    expiresAt: Date
  } | null> {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('oauth_refresh_tokens')
      .select('*')
      .eq('token', token)
      .single()

    if (error || !data) {
      return null
    }

    // Check expiration
    if (new Date(data.expires_at) < new Date()) {
      // Cleanup expired token
      await this.delete(token)
      return null
    }

    return {
      userId: data.user_id,
      clientId: data.client_id,
      scope: data.scope,
      issuedAt: new Date(data.issued_at),
      expiresAt: new Date(data.expires_at),
    }
  },

  /**
   * Delete a refresh token
   */
  async delete(token: string) {
    const supabase = getSupabaseClient()
    await supabase.from('oauth_refresh_tokens').delete().eq('token', token)
  }
}

