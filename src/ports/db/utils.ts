import { IConfigComponent } from '@well-known-components/interfaces'

export const getDbString = async (config: IConfigComponent, dbPrefix: string): Promise<string> => {
  let databaseUrl: string | undefined = await config.getString(`${dbPrefix}_PSQL_CONNECTION_STRING`)
  if (!databaseUrl) {
    const dbUser = await config.requireString(`${dbPrefix}_PSQL_USER`)
    const dbDatabaseName = await config.requireString(`${dbPrefix}_PSQL_DATABASE`)
    const dbPort = await config.requireString(`${dbPrefix}_PSQL_PORT`)
    const dbHost = await config.requireString(`${dbPrefix}_PSQL_HOST`)
    const dbPassword = await config.requireString(`${dbPrefix}_PSQL_PASSWORD`)

    databaseUrl = `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbDatabaseName}`
  }
  return databaseUrl
}
