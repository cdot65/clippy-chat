/** Shared client_credentials minting for the two machine identities Clippy
 *  holds against AIRS: `mcp.invoke` for the MCP route and `completions.write`
 *  for inference. The scopes stay on separate clients on purpose — a token
 *  carrying both would defeat the cross-route denials the Security Handoff
 *  negative-tests (see docs-site/docs/security/overview.mdx). */
export type M2mCredential = { accessToken: string; expiresAt: number }

export type M2mConfig = {
  tokenUrl?: string
  clientId?: string
  clientSecret?: string
  /** identity label used in error messages, e.g. 'MCP' or 'inference' */
  label: string
}

const EXPIRY_SKEW_MS = 30_000
const TOKEN_TIMEOUT_MS = 10_000

/** Returns a minter that caches until skew-before-expiry and single-flights
 *  concurrent callers, so a burst of chat turns mints one token, not N. */
export function createTokenMinter(readConfig: () => M2mConfig) {
  let cached: M2mCredential | null = null
  let pending: Promise<M2mCredential> | null = null

  async function mint(): Promise<M2mCredential> {
    const { tokenUrl, clientId, clientSecret, label } = readConfig()
    if (!tokenUrl || !clientId || !clientSecret)
      throw new Error(`${label} client credentials are not configured`)

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`${label} token request failed (${response.status})`)
    const value = await response.json().catch(() => null) as unknown
    if (!value || typeof value !== 'object') throw new Error(`invalid ${label} token response`)
    const accessToken = Reflect.get(value, 'access_token')
    const expiresIn = Number(Reflect.get(value, 'expires_in'))
    if (typeof accessToken !== 'string' || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0)
      throw new Error(`invalid ${label} token response`)
    return { accessToken, expiresAt: Date.now() + expiresIn * 1000 }
  }

  return {
    get: async (): Promise<M2mCredential> => {
      if (cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now()) return cached
      if (pending) return pending
      pending = mint().then((credential) => (cached = credential)).finally(() => { pending = null })
      return pending
    },
    reset: () => { cached = null; pending = null },
  }
}
