export function fromSecondsToMilliseconds(seconds: number): number {
  if (seconds.toString().length >= 12) {
    return seconds
  }
  return seconds * 1000
}
