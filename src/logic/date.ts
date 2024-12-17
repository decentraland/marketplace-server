export function fromMillisecondsToSeconds(timeInMilliseconds: number): number {
  return Math.floor(timeInMilliseconds / 1000)
}

// it rounds the time to the nearest second since the trades are stored with a precision of milliseconds already
export function fromSecondsToMilliseconds(time: number): number {
  if (time.toString().length <= 10) {
    return Math.round(time * 1000)
  }
  return Math.round(time)
}
