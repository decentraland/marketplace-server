import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE MATERIALIZED VIEW mv_builder_server_items AS
        SELECT 
            collections.contract_address || '-' || items.blockchain_item_id AS item_id,
            jsonb_array_elements_text(items.data::jsonb->'tags') AS tag
        FROM 
            builder_server_items items
        JOIN 
            builder_server_collections collections ON items.collection_id = collections.id;
    `)
  pgm.sql('CREATE UNIQUE INDEX idx_mv_builder_server_items ON mv_builder_server_items (item_id, tag);')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP INDEX idx_mv_builder_server_items;')
  pgm.sql('DROP MATERIALIZED VIEW mv_builder_server_items;')
}
