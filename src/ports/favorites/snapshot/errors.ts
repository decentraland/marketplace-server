export class ScoreError extends Error {
  constructor(message: string, public address: string) {
    super(`Error loading user score: ${message}`)
  }
}
