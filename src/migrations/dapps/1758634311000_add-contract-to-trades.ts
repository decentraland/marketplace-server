/* eslint-disable @typescript-eslint/naming-convention */
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'
import { ChainId } from '@dcl/schemas/dist/dapps/chain-id'
import { Network } from '@dcl/schemas/dist/dapps/network'
import { ContractName, getContract } from 'decentraland-transactions'

export const SCHEMA = 'marketplace'
export const TRADES_TABLE = 'trades'
export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const ethChainId = await config.requireString('ETHEREUM_CHAIN_ID')
  const polygonChainId = await config.requireString('POLYGON_CHAIN_ID')
  const ethMarketplaceContractAddress = getContract(ContractName.OffChainMarketplace, ethChainId as unknown as ChainId)
  const polygonMarketplaceContractAddress = getContract(ContractName.OffChainMarketplace, polygonChainId as unknown as ChainId)
  // Add contract column to trades table
  pgm.addColumn(
    { schema: SCHEMA, name: TRADES_TABLE },
    {
      contract: {
        type: 'text',
        notNull: true,
        default: polygonMarketplaceContractAddress.address
      }
    }
  )

  // Update existing ethereum trades to have their address correctly
  pgm.sql(`
    UPDATE ${SCHEMA}.${TRADES_TABLE} 
    SET contract = '${ethMarketplaceContractAddress.address}' 
    WHERE network = '${Network.ETHEREUM}';
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn({ schema: SCHEMA, name: TRADES_TABLE }, 'contract')
}
