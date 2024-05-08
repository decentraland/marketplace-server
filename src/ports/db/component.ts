import path from 'path'
import { IBaseComponent } from '@well-known-components/interfaces'
import { createPgComponent as createBasePgComponent, Options } from '@well-known-components/pg-component'
import { PoolClient } from 'pg'
import { IPgComponent } from './types'

export async function createPgComponent(
  components: createBasePgComponent.NeededComponents,
  options: { dbPrefix: string } & Options
): Promise<IPgComponent & IBaseComponent> {
  const { config, logs, metrics } = components
  const { dbPrefix } = options
  let databaseUrl: string | undefined = await config.getString(`${dbPrefix}_PG_COMPONENT_PSQL_CONNECTION_STRING`)
  if (!databaseUrl) {
    const dbUser = await config.requireString(`${dbPrefix}_PG_COMPONENT_PSQL_USER`)
    const dbDatabaseName = await config.requireString(`${dbPrefix}_PG_COMPONENT_PSQL_DATABASE`)
    const dbPort = await config.requireString(`${dbPrefix}_PG_COMPONENT_PSQL_PORT`)
    const dbHost = await config.requireString(`${dbPrefix}_PG_COMPONENT_PSQL_HOST`)
    const dbPassword = await config.requireString(`${dbPrefix}_PG_COMPONENT_PSQL_PASSWORD`)

    databaseUrl = `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbDatabaseName}`
  }

  const schema = await config.getString(`${dbPrefix}_PG_COMPONENT_PSQL_SCHEMA`)

  const pg = await createBasePgComponent(
    { config, logs, metrics },
    {
      ...options,
      pool: {
        connectionString: databaseUrl
      },
      migration: {
        databaseUrl,
        ...(schema ? { schema } : {}),
        dir: path.resolve(__dirname, `../../migrations/${dbPrefix.toLowerCase()}`),
        migrationsTable: 'pgmigrations',
        ignorePattern: '.*\\.map',
        direction: 'up'
      }
    }
  )

  async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>, onError?: (error: unknown) => Promise<void>): Promise<T> {
    const client = await pg.getPool().connect()

    try {
      await client.query('BEGIN')
      const result = await callback(client)
      await client.query('COMMIT')

      return result
    } catch (error) {
      await client.query('ROLLBACK')
      if (onError) await onError(error)
      throw error
    } finally {
      // TODO: handle the following eslint-disable statement
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await client.release()
    }
  }

  return { ...pg, withTransaction }
}
