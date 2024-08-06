/* eslint-disable @typescript-eslint/naming-convention */
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'
export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const marketplaceServerDBUser = await config.requireString('DAPPS_PG_COMPONENT_PSQL_PASSWORD')
  const builderServerDBHost = await config.requireString('BUILDER_SERVER_DB_HOST')
  const builderServerDBPort = await config.requireString('PG_COMPONENT_PSQL_PORT')
  const builderServerDBUser = await config.requireString('BUILDER_SERVER_DB_USER')
  const builderServerDBPassword = await config.requireString('BUILDER_SERVER_DB_PASSWORD')

  pgm.sql('CREATE EXTENSION IF NOT EXISTS postgres_fdw;')
  pgm.sql(`
            CREATE SERVER IF NOT EXISTS builder_server
            FOREIGN DATA WRAPPER postgres_fdw
            OPTIONS (host '${builderServerDBHost}', port '${builderServerDBPort}', dbname 'builder');
    `)
  pgm.sql(`CREATE USER MAPPING IF NOT EXISTS FOR ${marketplaceServerDBUser}
            SERVER builder_server
            OPTIONS (user '${builderServerDBUser}', password '${builderServerDBPassword}');`)

  pgm.sql(`CREATE FOREIGN TABLE IF NOT EXISTS builder_server_items (
                collection_id uuid,
                blockchain_item_id text,
                data text
            )
            SERVER builder_server
            OPTIONS (schema_name 'public', table_name 'items');
            
            CREATE FOREIGN TABLE IF NOT EXISTS builder_server_collections (
                id uuid,
                contract_address text
            )
            SERVER builder_server
            OPTIONS (schema_name 'public', table_name 'collections');`)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const marketplaceServerDBUser = await config.requireString('DAPPS_PG_COMPONENT_PSQL_PASSWORD')
  pgm.sql('DROP FOREIGN TABLE builder_server_items;')
  pgm.sql('DROP FOREIGN TABLE builder_server_collections;')
  pgm.sql(`DROP USER MAPPING FOR ${marketplaceServerDBUser} SERVER builder_server;`)
  pgm.sql('DROP SERVER builder_server CASCADE;')
  pgm.sql('DROP EXTENSION IF EXISTS postgres_fdw;')
}
