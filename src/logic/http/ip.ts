/**
 * Resolves the originating end-user IP from an incoming request.
 *
 * The API runs behind Cloudflare, which sets `cf-connecting-ip` to the real
 * client IP, so that header is preferred. The left-most entry of
 * `x-forwarded-for` (the originating client, before any proxy hops) is used as
 * a fallback. Returns `undefined` when neither header is present.
 */
export function getClientIp(request: { headers: { get(name: string): string | null } }): string | undefined {
  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  if (cfConnectingIp?.trim()) {
    return cfConnectingIp.trim()
  }

  const forwardedFor = request.headers.get('x-forwarded-for')
  const originatingIp = forwardedFor?.split(',')[0]?.trim()
  return originatingIp || undefined
}
