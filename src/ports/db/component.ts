import path from 'path'
import { IBaseComponent, IConfigComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { PoolClient } from 'pg'
import { createPgComponent as createBasePgComponent, Options } from '@dcl/pg-component'
import { IPgComponent } from './types'

/**
 * The connection string for a database prefix, either given whole or assembled from its parts.
 *
 * Exported because the neighbours rebuild needs its own connection rather than one from the pool -- the
 * pool caps every statement at 40 seconds and that job's first scan runs past 80 -- and it must reach
 * the same database this resolves to, not a second guess at how the environment is spelled.
 */
export async function resolveConnectionString(config: IConfigComponent, dbPrefix: string): Promise<string> {
  const connectionString = await config.getString(`${dbPrefix}_PG_COMPONENT_PSQL_CONNECTION_STRING`)
  if (connectionString) return connectionString

  const dbUser = await config.requireString(`${dbPrefix}_PG_COMPONENT_PSQL_USER`)
  const dbDatabaseName = await config.requireString(`${dbPrefix}_PG_COMPONENT_PSQL_DATABASE`)
  const dbPort = await config.requireString(`${dbPrefix}_PG_COMPONENT_PSQL_PORT`)
  const dbHost = await config.requireString(`${dbPrefix}_PG_COMPONENT_PSQL_HOST`)
  const dbPassword = await config.requireString(`${dbPrefix}_PG_COMPONENT_PSQL_PASSWORD`)

  return `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbDatabaseName}`
}

export async function createPgComponent(
  components: { config: IConfigComponent; logs: ILoggerComponent; metrics?: IMetricsComponent<string> },
  options: { dbPrefix: string; migrations?: boolean } & Options
): Promise<IPgComponent & IBaseComponent> {
  const { config, logs, metrics } = components
  const { dbPrefix, migrations = true } = options
  const databaseUrl = await resolveConnectionString(config, dbPrefix)

  const schema = await config.getString(`${dbPrefix}_PG_COMPONENT_PSQL_SCHEMA`)

  const pg = await createBasePgComponent(
    { config, logs, metrics },
    {
      pool: {
        connectionString: databaseUrl,
        query_timeout: 40000, // 40 seconds,
        statement_timeout: 40000 // 40 seconds,
      },
      ...(migrations
        ? {
            migration: {
              ...(schema ? { schema } : {}),
              dir: path.resolve(__dirname, `../../migrations/${dbPrefix.toLowerCase()}`),
              migrationsTable: 'pgmigrations',
              ignorePattern: '.*\\.map',
              direction: 'up'
            }
          }
        : {})
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
