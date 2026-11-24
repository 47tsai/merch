// Shared Chi Auth check for both Worker entry points (index.ts + r2-entry.ts).
// One copy only: the two entries used to carry identical copies, and a fix
// applied to one of them could silently miss the other.
export interface AuthEnv {
  CHI_AUTH_URL: string;
  CHI_AUTH_CLIENT_ID?: string;
}

export async function authorized(request: Request, env: AuthEnv): Promise<boolean> {
  const clientId = env.CHI_AUTH_CLIENT_ID?.trim();
  const configuredAuthUrl = env.CHI_AUTH_URL || 'https://auth.chi.qzz.io';
  const authUrl = configuredAuthUrl.endsWith('/') ? configuredAuthUrl.slice(0, -1) : configuredAuthUrl;
  const match = (request.headers.get('Authorization') || '').match(/^Bearer ([A-Za-z0-9_-]{40,80})$/);
  if (!clientId || !match) return false;
  try {
    const response = await fetch(`${authUrl}/api/userinfo?client_id=${encodeURIComponent(clientId)}`, {
      headers: { Authorization: `Bearer ${match[1]}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const identity = (await response.json()) as { sub?: unknown; aud?: unknown };
    return identity.sub === 'chi-owner' && identity.aud === clientId;
  } catch {
    return false;
  }
}
