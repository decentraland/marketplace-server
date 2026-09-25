import { createDisabledJobComponent } from '../../src/ports/job'

describe('when a job is disabled by configuration', () => {
  let logger: { info: jest.Mock }
  let job: ReturnType<typeof createDisabledJobComponent>

  beforeEach(() => {
    logger = { info: jest.fn() }
    job = createDisabledJobComponent(logger, 'item neighbours rebuild')
  })

  describe('and the component tree starts it', () => {
    beforeEach(() => {
      job.start()
    })

    it('should say so, since a silently absent job is indistinguishable from a broken one', () => {
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('item neighbours rebuild'))
    })

    it('should name the reason, so the fix is to set the switch rather than to debug the job', () => {
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('disabled by configuration'))
    })
  })

  describe('and the component tree stops it', () => {
    it('should resolve rather than throw, so a shutdown is not held up by a job that never ran', async () => {
      await expect(job.stop()).resolves.toBeUndefined()
    })
  })
})

describe('when reading the neighbours job switch', () => {
  /** The exact expression `initComponents` uses, pinned here so the default cannot drift unnoticed. */
  const enabled = (value: string | undefined) => value !== 'false'

  describe('and nothing is configured', () => {
    it('should run the job, because a rebuild that never runs is the broken state, not the safe one', () => {
      expect(enabled(undefined)).toBe(true)
    })
  })

  describe('and it is switched off explicitly', () => {
    it('should stop the job, which is the whole point of having the switch', () => {
      expect(enabled('false')).toBe(false)
    })
  })

  describe('and it carries anything else', () => {
    it('should run the job rather than let a typo silently disable the feature', () => {
      expect([enabled('true'), enabled('yes'), enabled(''), enabled('FALSE')]).toEqual([true, true, true, true])
    })
  })
})
