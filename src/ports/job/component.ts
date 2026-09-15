import { AppComponents } from '../../types'
import { IJobComponent, JobOptions } from './types'

export function createJobComponent(
  components: Pick<AppComponents, 'logs'>,
  /** The function to execute as a job. Admits asynchronous functions. */
  job: () => any,
  /** The amount of time to wait between jobs */
  onTime: number,
  { repeat = true, startupDelay = 0, onError = () => undefined, onFinish = () => undefined }: JobOptions = {
    repeat: true,
    startupDelay: 0,
    onError: () => undefined,
    onFinish: () => undefined
  }
): IJobComponent {
  const { logs } = components
  let runningJob: Promise<any> = Promise.resolve()
  let shouldStop = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let resolveSleepCancel: ((value: unknown) => void) | undefined
  const logger = logs.getLogger('job')

  async function sleep(time: number) {
    return new Promise(resolve => {
      resolveSleepCancel = resolve
      timeout = setTimeout(() => {
        resolveSleepCancel = undefined
        timeout = undefined
        resolve(undefined)
      }, time)
    })
  }

  function cancelSleep() {
    if (timeout && resolveSleepCancel) {
      clearTimeout(timeout)
      resolveSleepCancel(undefined)
    }
  }

  function start() {
    // Start the job but don't wait for it
    runJob()
  }

  async function runJob() {
    await sleep(startupDelay)
    while (!shouldStop) {
      try {
        runningJob = job()
        await runningJob
      } catch (error) {
        onError(error)
      }
      logger.info('[Executed]')
      if (!repeat) {
        break
      }
      await sleep(onTime)
    }
    await onFinish()
    logger.info('[Stopped]')
  }

  async function stop() {
    logger.info('[Cancelling]')
    shouldStop = true
    cancelSleep()
    await runningJob
    logger.info('[Cancelled]')
  }

  return {
    start,
    stop
  }
}

/**
 * A job that exists in the component tree and does nothing.
 *
 * Returned in place of a real job when its feature switch is off, so the switch costs no branching at
 * every use site and, more importantly, so "off" means the schedule is never armed rather than armed
 * and then ignored. Whatever the job needs to build itself — connections, credentials, a pool — is not
 * built either, because this is constructed instead of it and not alongside it.
 */
export function createDisabledJobComponent(logger: { info: (message: string) => void }, name: string): IJobComponent {
  return {
    start: () => logger.info(`${name} is disabled by configuration; nothing scheduled`),
    stop: async () => undefined
  }
}
