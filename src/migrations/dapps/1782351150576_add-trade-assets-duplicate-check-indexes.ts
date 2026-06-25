/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

const SCHEMA = 'marketplace'
const TRADE_ASSETS_TABLE = 'trade_assets'
const TRADE_ASSETS_ITEM_TABLE = 'trade_assets_item'

const CONTRACT_DIRECTION_INDEX = 'idx_trade_assets_contract_address_direction'
const TRADE_ID_INDEX = 'idx_trade_assets_trade_id'
const ITEM_ID_INDEX = 'idx_trade_assets_item_item_id'

export const shorthands: ColumnDefinitions | undefined = undefined

// Indexes that back the live "is there an open public_item_order for this item?" check used when
// creating trades (see getOpenItemOrderExistsQuery). Without them the check sequential-scans the
// whole trades history; with them it stays a selective lookup over a single collection/item.
// Created CONCURRENTLY so the migration does not lock writes on the trades tables in production.
export async function up(pgm: MigrationBuilder): Promise<void> {
  // CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
  pgm.noTransaction()

  pgm.createIndex({ schema: SCHEMA, name: TRADE_ASSETS_TABLE }, ['contract_address', 'direction'], {
    name: CONTRACT_DIRECTION_INDEX,
    concurrently: true,
    ifNotExists: true
  })

  // trade_assets.trade_id is a foreign key; Postgres does not index FKs automatically.
  pgm.createIndex({ schema: SCHEMA, name: TRADE_ASSETS_TABLE }, ['trade_id'], {
    name: TRADE_ID_INDEX,
    concurrently: true,
    ifNotExists: true
  })

  pgm.createIndex({ schema: SCHEMA, name: TRADE_ASSETS_ITEM_TABLE }, ['item_id'], {
    name: ITEM_ID_INDEX,
    concurrently: true,
    ifNotExists: true
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // DROP INDEX CONCURRENTLY cannot run inside a transaction block.
  pgm.noTransaction()

  pgm.dropIndex({ schema: SCHEMA, name: TRADE_ASSETS_TABLE }, ['contract_address', 'direction'], {
    name: CONTRACT_DIRECTION_INDEX,
    concurrently: true,
    ifExists: true
  })

  pgm.dropIndex({ schema: SCHEMA, name: TRADE_ASSETS_TABLE }, ['trade_id'], {
    name: TRADE_ID_INDEX,
    concurrently: true,
    ifExists: true
  })

  pgm.dropIndex({ schema: SCHEMA, name: TRADE_ASSETS_ITEM_TABLE }, ['item_id'], {
    name: ITEM_ID_INDEX,
    concurrently: true,
    ifExists: true
  })
}
