declare module 'pg-cursor' {
  type ReadCallback = (err: Error | null, rows: unknown[][]) => void

  class Cursor {
    constructor(text: string, values?: unknown[], config?: { rowMode?: 'array' })
    read(rowCount: number, callback: ReadCallback): void
    close(callback: () => void): void
  }

  export = Cursor
}
