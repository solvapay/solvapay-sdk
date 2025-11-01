const SESSION_COOKIE_NAME = 'sp_session';

function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('Missing SESSION_SECRET');
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: { userId: string }) {
  const { SignJWT } = await import('jose');
  const jwt = await new SignJWT({ sub: payload.userId, kind: 'session' })
    .setProtectedHeader({ alg: 'HS256', kid: 'session-key' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSessionSecret());
  return jwt;
}

export async function readSessionUserIdFromRequest(req: Request): Promise<string | null> {
  try {
    const cookieHeader = (req.headers.get('cookie') || '') as string;
    const cookieValue = cookieHeader
      .split(';')
      .map(v => v.trim())
      .find(v => v.startsWith(`${SESSION_COOKIE_NAME}=`))
      ?.split('=')[1];
    if (!cookieValue) return null;
    const { jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(cookieValue, getSessionSecret());
    return (payload.sub as string) || null;
  } catch {
    return null;
  }
}

export { SESSION_COOKIE_NAME };


