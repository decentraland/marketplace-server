import { rebuildItemSearchWords, SEARCH_WORDS_TABLE } from '../../src/logic/catalog/search-words-table'

let queryMock: jest.Mock
let client: { query: jest.Mock }

const statements = () => queryMock.mock.calls.map(([sql]) => sql as string)
const indexOf = (fragment: string) => statements().findIndex(sql => sql.includes(fragment))
// The staging name contains the live name, so matching the live table needs the staging rows excluded.
const indexOfLiveDrop = () => statements().findIndex(sql => sql === `DROP TABLE IF EXISTS ${SEARCH_WORDS_TABLE}`)

const lockAcquired = () => ({ rows: [{ acquired: true }] })

beforeEach(() => {
  queryMock = jest.fn().mockResolvedValue({ rows: [] })
  client = { query: queryMock }
})

describe('when rebuilding the item search words table', () => {
  describe('and the advisory lock is available', () => {
    beforeEach(() => {
      queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce(lockAcquired())
    })

    it('should report that it rebuilt the table', async () => {
      await expect(rebuildItemSearchWords(client)).resolves.toBe('rebuilt')
    })

    it('should commit exactly once and never roll back', async () => {
      await rebuildItemSearchWords(client)

      expect(statements().filter(sql => sql === 'BEGIN')).toHaveLength(1)
      expect(statements().filter(sql => sql === 'COMMIT')).toHaveLength(1)
      expect(statements()).not.toContain('ROLLBACK')
    })

    it('should build and index the staging table before touching the live one', async () => {
      await rebuildItemSearchWords(client)

      const created = indexOf('CREATE TABLE marketplace.item_search_words_staging')
      const indexed = indexOf('CREATE INDEX idx_item_search_words_word_trgm_staging')
      const dropped = indexOfLiveDrop()
      const renamed = indexOf('RENAME TO item_search_words')

      expect(created).toBeGreaterThan(-1)
      expect(indexed).toBeGreaterThan(created)
      expect(dropped).toBeGreaterThan(indexed)
      expect(renamed).toBeGreaterThan(dropped)
    })

    it('should drop the live table only after the commit is the next step, so a failed build changes nothing', async () => {
      await rebuildItemSearchWords(client)
      const all = statements()

      // everything expensive happens before the live table is dropped
      expect(all.indexOf('COMMIT')).toBeGreaterThan(indexOfLiveDrop())
      expect(indexOfLiveDrop()).toBeGreaterThan(indexOf('CREATE TABLE marketplace.item_search_words_staging'))
    })

    it('should name the operator class schema, since migrations run without public on the search path', async () => {
      await rebuildItemSearchWords(client)

      const index = statements().find(sql => sql.includes('USING gin'))
      expect(index).toContain('public.gin_trgm_ops')
    })

    it('should rename the staging index so the next rebuild finds the expected name free', async () => {
      await rebuildItemSearchWords(client)

      expect(
        statements().some(
          sql => sql.includes('ALTER INDEX') && sql.includes('_staging') && sql.includes('RENAME TO idx_item_search_words_word_trgm')
        )
      ).toBe(true)
    })
  })

  describe('and another instance already holds the advisory lock', () => {
    beforeEach(() => {
      queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ acquired: false }] })
    })

    it('should report that it skipped the rebuild', async () => {
      await expect(rebuildItemSearchWords(client)).resolves.toBe('skipped')
    })

    it('should roll back without issuing any DDL', async () => {
      await rebuildItemSearchWords(client)

      expect(statements()).toContain('ROLLBACK')
      expect(statements().join('\n')).not.toMatch(/CREATE TABLE|DROP TABLE|ALTER TABLE/)
    })
  })

  describe('and building the staging table fails', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('canceling statement due to statement timeout')
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('pg_try_advisory_xact_lock')) return Promise.resolve(lockAcquired())
        if (sql.includes('CREATE TABLE marketplace.item_search_words_staging')) return Promise.reject(error)
        return Promise.resolve({ rows: [] })
      })
    })

    it('should roll back and propagate the error so the caller can log it', async () => {
      await expect(rebuildItemSearchWords(client)).rejects.toThrow(error)

      expect(statements()).toContain('ROLLBACK')
      expect(statements()).not.toContain('COMMIT')
    })

    it('should never have dropped the live table', async () => {
      await expect(rebuildItemSearchWords(client)).rejects.toThrow(error)

      expect(indexOfLiveDrop()).toBe(-1)
    })
  })
})
