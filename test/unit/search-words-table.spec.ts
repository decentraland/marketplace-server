import { CREATOR_SEARCH_WORDS_TABLE } from '../../src/logic/catalog/creator-profiles'
import { rebuildSearchTables, SEARCH_NAMES_TABLE, SEARCH_WORDS_TABLE } from '../../src/logic/catalog/search-words-table'

let queryMock: jest.Mock
let client: { query: jest.Mock }

const statements = () => queryMock.mock.calls.map(([sql]) => sql as string)
const indexOf = (fragment: string) => statements().findIndex(sql => sql.includes(fragment))
// The staging name contains the live name, so matching the live table needs the staging rows excluded.
const indexOfLiveDrop = () => statements().findIndex(sql => sql === `DROP TABLE IF EXISTS ${SEARCH_WORDS_TABLE}`)
const indexOfNamesDrop = () => statements().findIndex(sql => sql === `DROP TABLE IF EXISTS ${SEARCH_NAMES_TABLE}`)
const indexOfCreatorDrop = () => statements().findIndex(sql => sql === `DROP TABLE IF EXISTS ${CREATOR_SEARCH_WORDS_TABLE}`)

const lockAcquired = () => ({ rows: [{ acquired: true }] })

beforeEach(() => {
  queryMock = jest.fn().mockResolvedValue({ rows: [] })
  client = { query: queryMock }
})

describe('when rebuilding the search tables', () => {
  describe('and the advisory lock is available', () => {
    beforeEach(() => {
      queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce(lockAcquired())
    })

    it('should report that it rebuilt the table', async () => {
      await expect(rebuildSearchTables(client)).resolves.toBe('rebuilt')
    })

    it('should commit exactly once and never roll back', async () => {
      await rebuildSearchTables(client)

      expect(statements().filter(sql => sql === 'BEGIN')).toHaveLength(1)
      expect(statements().filter(sql => sql === 'COMMIT')).toHaveLength(1)
      expect(statements()).not.toContain('ROLLBACK')
    })

    it('should build and index the staging table before touching the live one', async () => {
      await rebuildSearchTables(client)

      const created = indexOf('CREATE TABLE marketplace.item_search_words_v3_staging')
      const indexed = indexOf('CREATE INDEX idx_item_search_words_v3_word_trgm_staging')
      const dropped = indexOfLiveDrop()
      const renamed = indexOf('RENAME TO item_search_words_v3')

      expect(created).toBeGreaterThan(-1)
      expect(indexed).toBeGreaterThan(created)
      expect(dropped).toBeGreaterThan(indexed)
      expect(renamed).toBeGreaterThan(dropped)
    })

    it('should drop the live table only after the commit is the next step, so a failed build changes nothing', async () => {
      await rebuildSearchTables(client)
      const all = statements()

      // everything expensive happens before the live table is dropped
      expect(all.indexOf('COMMIT')).toBeGreaterThan(indexOfLiveDrop())
      expect(indexOfLiveDrop()).toBeGreaterThan(indexOf('CREATE TABLE marketplace.item_search_words_v3_staging'))
    })

    it('should name the operator class schema, since migrations run without public on the search path', async () => {
      await rebuildSearchTables(client)

      const index = statements().find(sql => sql.includes('USING gin'))
      expect(index).toContain('public.gin_trgm_ops')
    })

    it('should rebuild the names table in the same transaction, swapping it in after the words', async () => {
      await rebuildSearchTables(client)

      const namesBuilt = indexOf('CREATE TABLE marketplace.item_search_names_staging')
      const namesDropped = indexOfNamesDrop()
      const namesRenamed = indexOf('RENAME TO item_search_names')

      expect(namesBuilt).toBeGreaterThan(-1)
      expect(namesDropped).toBeGreaterThan(indexOfLiveDrop())
      expect(namesRenamed).toBeGreaterThan(namesDropped)
      expect(statements().indexOf('COMMIT')).toBeGreaterThan(namesRenamed)
    })

    it('should give every item the words of its creator, from the profiles table, under their own source', async () => {
      await rebuildSearchTables(client)

      const build = statements().find(sql => sql.includes('CREATE TABLE marketplace.item_search_words_v3_staging')) as string
      expect(build).toContain("'creator' AS source")
      expect(build).toContain('marketplace.creator_profiles AS cp')
      expect(build).toContain('cp.address = items.creator')
      // The profile name and the first ten NAMEs, as one list: an item does not inherit a hoard of names.
      expect(build).toContain('unnest(array_prepend(cp.name, cp.names[1:10])) WITH ORDINALITY AS n(name, entry)')
    })

    it('should pair adjacent words only within the same name, so two names under one item never blend', async () => {
      await rebuildSearchTables(client)

      const build = statements().find(sql => sql.includes('CREATE TABLE marketplace.item_search_words_v3_staging')) as string
      expect(build).toContain('AND b.entry = a.entry')
      expect(build).toContain('AND b.position = a.position + 1')
    })

    it('should rebuild the creator words in the same transaction, keyed by creator, swapped in last', async () => {
      await rebuildSearchTables(client)

      const build = statements().find(sql => sql.includes('CREATE TABLE marketplace.creator_search_words_staging')) as string
      expect(build).toContain('GROUP BY address, word, source')
      expect(build).toContain("CASE WHEN n.entry = 1 THEN 'profile' ELSE 'ens' END AS source")
      // EVERY NAME here, so the holder of the eleventh is still found by it.
      expect(build).toContain('unnest(array_prepend(cp.name, cp.names)) WITH ORDINALITY AS n(name, entry)')
      const creatorDropped = indexOfCreatorDrop()
      const creatorRenamed = indexOf('RENAME TO creator_search_words')
      expect(creatorDropped).toBeGreaterThan(indexOfNamesDrop())
      expect(creatorRenamed).toBeGreaterThan(creatorDropped)
      expect(statements().indexOf('COMMIT')).toBeGreaterThan(creatorRenamed)
      expect(
        statements().some(sql => sql.includes('idx_creator_search_words_word_trgm_staging') && sql.includes('public.gin_trgm_ops'))
      ).toBe(true)
    })

    it("should precompute each creator name's phrase and sorted words, swapped in last, for the ranking bonuses", async () => {
      await rebuildSearchTables(client)

      const build = statements().find(sql => sql.includes('CREATE TABLE marketplace.creator_search_names_staging')) as string
      expect(build).toContain('marketplace.search_phrase(n.name) AS phrase')
      expect(build).toContain('AS sorted_words')
      expect(build).toContain('unnest(array_prepend(cp.name, cp.names)) AS n(name)')
      const renamed = indexOf('RENAME TO creator_search_names')
      expect(renamed).toBeGreaterThan(indexOf('RENAME TO creator_search_words'))
      expect(statements().indexOf('COMMIT')).toBeGreaterThan(renamed)
    })

    it("should never touch the previous releases' tables, which their instances keep reading and rebuilding during a roll-out", async () => {
      await rebuildSearchTables(client)

      expect(statements().join('\n')).not.toMatch(/marketplace\.item_search_words(?!_v3|_names)/)
    })

    it('should rename the staging index so the next rebuild finds the expected name free', async () => {
      await rebuildSearchTables(client)

      expect(
        statements().some(
          sql => sql.includes('ALTER INDEX') && sql.includes('_staging') && sql.includes('RENAME TO idx_item_search_words_v3_word_trgm')
        )
      ).toBe(true)
    })
  })

  describe('and another instance already holds the advisory lock', () => {
    beforeEach(() => {
      queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ acquired: false }] })
    })

    it('should report that it skipped the rebuild', async () => {
      await expect(rebuildSearchTables(client)).resolves.toBe('skipped')
    })

    it('should roll back without issuing any DDL', async () => {
      await rebuildSearchTables(client)

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
        if (sql.includes('CREATE TABLE marketplace.item_search_words_v3_staging')) return Promise.reject(error)
        return Promise.resolve({ rows: [] })
      })
    })

    it('should roll back and propagate the error so the caller can log it', async () => {
      await expect(rebuildSearchTables(client)).rejects.toThrow(error)

      expect(statements()).toContain('ROLLBACK')
      expect(statements()).not.toContain('COMMIT')
    })

    it('should never have dropped the live table', async () => {
      await expect(rebuildSearchTables(client)).rejects.toThrow(error)

      expect(indexOfLiveDrop()).toBe(-1)
    })
  })
})
