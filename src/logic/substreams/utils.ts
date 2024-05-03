import { PoolClient } from 'pg'
import { getChainName } from '@dcl/schemas'
import { getLatestChainSchema } from '../../ports/catalog/queries'
import { getEthereumChainId, getPolygonChainId } from '../chainIds'

export const getLatestSchemas = async (client: PoolClient) => {
  const chains = [getEthereumChainId(), getPolygonChainId()]
  const latestSchemasPromises: Promise<string>[] = chains.map(getChainName).map(async chainName => {
    const query = getLatestChainSchema(String(chainName))
    const schemaName = await client.query<{
      entity_schema: string
    }>(query)
    return schemaName.rows[0].entity_schema
  })
  const schemas = await Promise.all(latestSchemasPromises)
  return schemas
}
