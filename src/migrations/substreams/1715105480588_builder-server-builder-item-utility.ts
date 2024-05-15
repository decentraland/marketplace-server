import { MigrationBuilder } from 'node-pg-migrate'

const materializedViewName = 'mv_builder_server_items_utility'

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Add utility to the foreign table
  pgm.sql('ALTER FOREIGN TABLE builder_server_items ADD COLUMN utility text;')

  // New materialized view for the utility
  pgm.createMaterializedView(
    materializedViewName,
    { ifNotExists: true },
    `SELECT
      collections.contract_address || '-' || server_items.blockchain_item_id AS item_id,
      server_items.utility as utility,
      blockchain_items.created_at
     FROM
      builder_server_items server_items, builder_server_collections collections, dcl36.items blockchain_items
     WHERE server_items.blockchain_item_id IS NOT NULL 
     AND server_items.utility IS NOT NULL 
     AND server_items.collection_id = collections.id 
     AND blockchain_items.id = (collections.contract_address || '-' || server_items.blockchain_item_id);`
  )
  pgm.addIndex(materializedViewName, ['item_id'], { name: 'idx_mv_builder_server_items_utility', unique: true })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Drop new materialized view
  pgm.dropMaterializedView(materializedViewName)

  // Restore old foreign table
  pgm.sql('ALTER FOREIGN TABLE builder_server_items DROP COLUMN utility;')
}
