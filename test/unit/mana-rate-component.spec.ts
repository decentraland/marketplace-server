import { createManaUsdRateComponent } from '../../src/ports/mana-rate/component'
import { IManaUsdRateComponent } from '../../src/ports/mana-rate/types'

// The aggregator methods are backed by these module-scope mocks so each test can drive the on-chain
// oracle response. Classes are used for the ethers constructors so `resetMocks` can't wipe them.
const mockDecimals = jest.fn()
const mockLatestRoundData = jest.fn()
const mockDestroy = jest.fn()

jest.mock('ethers', () => ({
  ethers: {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- must match the ethers API names.
    JsonRpcProvider: class {
      destroy = (...args: unknown[]) => mockDestroy(...args)
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- must match the ethers API names.
    Contract: class {
      decimals = (...args: unknown[]) => mockDecimals(...args)
      latestRoundData = (...args: unknown[]) => mockLatestRoundData(...args)
    }
  }
}))

// A recent unix timestamp (seconds) so the staleness guard passes unless a test overrides it.
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

// [roundId, answer, startedAt, updatedAt, answeredInRound]
function roundData(overrides: Partial<{ roundId: bigint; answer: bigint; updatedAt: number; answeredInRound: bigint }> = {}) {
  const roundId = overrides.roundId ?? 10n
  return [
    roundId,
    overrides.answer ?? 2_000_000n, // 0.02 USD/MANA at 8 decimals
    0n,
    BigInt(overrides.updatedAt ?? nowSeconds()),
    overrides.answeredInRound ?? roundId
  ]
}

function createConfig(values: Record<string, string | undefined>) {
  return {
    getString: jest.fn(async (key: string) => values[key]),
    getNumber: jest.fn(async (key: string) => (values[key] != null ? Number(values[key]) : undefined)),
    requireString: jest.fn(),
    requireNumber: jest.fn(),
    getBoolean: jest.fn(),
    requireBoolean: jest.fn()
  } as any
}

const warn = jest.fn()
const logs = {
  getLogger: () => ({ warn, info: jest.fn(), error: jest.fn(), debug: jest.fn() })
} as any

// The oracle-configured happy path config (decimals + a valid round).
const ORACLE_CONFIG = {
  RPC_ENDPOINT_POLYGON: 'http://rpc.example',
  MANA_USD_ORACLE_ADDRESS: '0xaggregator'
}

describe('MANA/USD rate component', () => {
  let component: IManaUsdRateComponent

  afterEach(async () => {
    await component?.stop?.()
  })

  describe('when the oracle is not configured', () => {
    it('should return the configured fallback rate and never throw on refresh', async () => {
      component = await createManaUsdRateComponent({ config: createConfig({ MANA_USD_FALLBACK_RATE: '0.05' }), logs })

      await expect(component.refresh()).resolves.toBeUndefined()
      expect(component.getRate()).toBe(0.05)
    })

    it('should fall back to the code default when no fallback is configured', async () => {
      component = await createManaUsdRateComponent({ config: createConfig({}), logs })

      expect(component.getRate()).toBe(0.02)
    })
  })

  describe('when the oracle is configured and answers a valid round', () => {
    it('should cache the converted USD-per-MANA rate after a refresh', async () => {
      mockDecimals.mockResolvedValue(8)
      mockLatestRoundData.mockResolvedValue(roundData({ answer: 3_500_000n })) // 0.035
      component = await createManaUsdRateComponent({ config: createConfig(ORACLE_CONFIG), logs })

      await component.refresh()

      expect(component.getRate()).toBeCloseTo(0.035, 8)
    })

    it('should keep the last-known rate when a later refresh fails (fail safe)', async () => {
      mockDecimals.mockResolvedValue(8)
      mockLatestRoundData.mockResolvedValueOnce(roundData({ answer: 4_000_000n })) // 0.04 on the first call
      component = await createManaUsdRateComponent({ config: createConfig(ORACLE_CONFIG), logs })

      await component.refresh()
      expect(component.getRate()).toBeCloseTo(0.04, 8)

      mockLatestRoundData.mockRejectedValueOnce(new Error('RPC down'))
      await expect(component.refresh()).resolves.toBeUndefined()

      // Still the last-known value, not the fallback.
      expect(component.getRate()).toBeCloseTo(0.04, 8)
    })
  })

  describe('when the oracle returns a bad round', () => {
    beforeEach(() => {
      mockDecimals.mockResolvedValue(8)
    })

    it('should ignore an incomplete round (answeredInRound < roundId) and use the fallback', async () => {
      mockLatestRoundData.mockResolvedValue(roundData({ roundId: 10n, answeredInRound: 9n }))
      component = await createManaUsdRateComponent({ config: createConfig({ ...ORACLE_CONFIG, MANA_USD_FALLBACK_RATE: '0.07' }), logs })

      await component.refresh()

      expect(component.getRate()).toBe(0.07)
    })

    it('should ignore a stale round and use the fallback', async () => {
      mockLatestRoundData.mockResolvedValue(roundData({ updatedAt: nowSeconds() - 200_000 }))
      component = await createManaUsdRateComponent({
        config: createConfig({ ...ORACLE_CONFIG, MANA_USD_FALLBACK_RATE: '0.07', MANA_ORACLE_MAX_STALENESS_SECONDS: '86400' }),
        logs
      })

      await component.refresh()

      expect(component.getRate()).toBe(0.07)
    })

    it('should ignore a non-positive rate and use the fallback', async () => {
      mockLatestRoundData.mockResolvedValue(roundData({ answer: 0n }))
      component = await createManaUsdRateComponent({ config: createConfig({ ...ORACLE_CONFIG, MANA_USD_FALLBACK_RATE: '0.07' }), logs })

      await component.refresh()

      expect(component.getRate()).toBe(0.07)
    })
  })

  describe('when starting the component', () => {
    it('should perform an initial refresh so the rate is available immediately', async () => {
      mockDecimals.mockResolvedValue(8)
      mockLatestRoundData.mockResolvedValue(roundData({ answer: 1_500_000n })) // 0.015
      component = await createManaUsdRateComponent({ config: createConfig(ORACLE_CONFIG), logs })

      await component.start?.({} as any)

      expect(component.getRate()).toBeCloseTo(0.015, 8)
    })

    it('should not block startup forever when the oracle hangs, booting on the fallback instead', async () => {
      mockDecimals.mockResolvedValue(8)
      // Oracle never answers: the initial refresh hangs, so start() must fall through on the timeout.
      mockLatestRoundData.mockReturnValue(new Promise(() => undefined))
      component = await createManaUsdRateComponent({
        config: createConfig({ ...ORACLE_CONFIG, MANA_USD_FALLBACK_RATE: '0.09', MANA_RATE_STARTUP_TIMEOUT_MS: '20' }),
        logs
      })

      await component.start?.({} as any)

      // Booted without a live rate; still returns the fallback rather than wedging.
      expect(component.getRate()).toBe(0.09)
    })
  })

  describe('when stopping the component', () => {
    it('should destroy the RPC provider so its sockets/timers are released', async () => {
      mockDecimals.mockResolvedValue(8)
      mockLatestRoundData.mockResolvedValue(roundData({ answer: 2_000_000n }))
      component = await createManaUsdRateComponent({ config: createConfig(ORACLE_CONFIG), logs })
      // A refresh builds the provider so stop() has something to tear down.
      await component.refresh()

      await component.stop?.()

      expect(mockDestroy).toHaveBeenCalledTimes(1)
    })
  })
})
