import { MigrationBuilder } from 'node-pg-migrate'
import { TRADES_MV_NAME } from '../../src/logic/trades/materialized-view'
import { up } from '../../src/migrations/dapps/1789400000000_recreate-trades-mv-with-chain-id'

describe('when running the migration that projects the trade chain into the trades view', () => {
  let statements: string[]
  let snapshot: number
  let drop: number
  let create: number
  let owner: number
  let restore: number

  beforeEach(async () => {
    statements = []
    await up({ sql: (statement: string) => statements.push(statement) } as unknown as MigrationBuilder)
    const indexOf = (needle: string) => statements.findIndex(statement => statement.includes(needle))
    snapshot = indexOf('CREATE TEMP TABLE mv_trades_prior_readers')
    drop = indexOf(`DROP MATERIALIZED VIEW IF EXISTS marketplace.${TRADES_MV_NAME}`)
    create = indexOf('CREATE MATERIALIZED VIEW')
    owner = indexOf('OWNER TO mv_trades_owner')
    restore = indexOf('FROM mv_trades_prior_readers')
  })

  it('should project the trade chain into the view it creates', () => {
    expect(statements[create]).toContain('t.chain_id,')
  })

  it('should snapshot the readers before dropping the view, while the grants still exist', () => {
    expect(snapshot).toBeLessThan(drop)
  })

  it('should read that snapshot from the catalogue and not from information_schema', () => {
    expect(statements[snapshot]).toContain('aclexplode')
  })

  it('should grant the view back to the snapshotted readers after it exists again', () => {
    expect(restore).toBeGreaterThan(create)
  })

  it('should replay the grants after the owner is set, when the session can grant on the view', () => {
    expect(restore).toBeGreaterThan(owner)
  })
})
