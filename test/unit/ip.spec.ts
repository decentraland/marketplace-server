import { getClientIp } from '../../src/logic/http/ip'

function requestWithHeaders(headers: Record<string, string | null>): { headers: { get(name: string): string | null } } {
  return {
    headers: {
      get: (name: string) => (name in headers ? headers[name] : null)
    }
  }
}

describe('when resolving the client IP from a request', () => {
  describe('and the cf-connecting-ip header is present', () => {
    it('should return its trimmed value, preferring it over x-forwarded-for', () => {
      const request = requestWithHeaders({ 'cf-connecting-ip': ' 203.0.113.7 ', 'x-forwarded-for': '198.51.100.1' })

      expect(getClientIp(request)).toBe('203.0.113.7')
    })
  })

  describe('and only the x-forwarded-for header is present', () => {
    it('should return the trimmed left-most (originating) address', () => {
      const request = requestWithHeaders({ 'x-forwarded-for': ' 198.51.100.4 , 10.0.0.1, 10.0.0.2' })

      expect(getClientIp(request)).toBe('198.51.100.4')
    })
  })

  describe('and the cf-connecting-ip header is blank', () => {
    it('should fall back to x-forwarded-for', () => {
      const request = requestWithHeaders({ 'cf-connecting-ip': '   ', 'x-forwarded-for': '198.51.100.4' })

      expect(getClientIp(request)).toBe('198.51.100.4')
    })
  })

  describe('and no IP headers are present', () => {
    it('should return undefined', () => {
      expect(getClientIp(requestWithHeaders({}))).toBeUndefined()
    })
  })

  describe('and x-forwarded-for is present but empty', () => {
    it('should return undefined', () => {
      expect(getClientIp(requestWithHeaders({ 'x-forwarded-for': '   ' }))).toBeUndefined()
    })
  })
})
