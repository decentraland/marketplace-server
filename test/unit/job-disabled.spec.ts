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
