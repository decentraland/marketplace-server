/* eslint-disable @typescript-eslint/naming-convention */
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { MigrationBuilder } from 'node-pg-migrate'
import { ChainId } from '@dcl/schemas/dist/dapps/chain-id'
import { ContractName, getContract } from 'decentraland-transactions'

// Stores trade contract addresses lowercased so they can be compared without LOWER().
export async function up(pgm: MigrationBuilder): Promise<void> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const polygonChainId = await config.requireString('POLYGON_CHAIN_ID')
  const defaultContract = getContract(ContractName.OffChainMarketplace, polygonChainId as unknown as ChainId).address.toLowerCase()

  pgm.sql('UPDATE marketplace.trades SET contract = LOWER(contract) WHERE contract <> LOWER(contract);')
  pgm.sql(`ALTER TABLE marketplace.trades ALTER COLUMN contract SET DEFAULT '${defaultContract}';`)
}

// No-op: the original casing isn't recorded, and every reader compares case-insensitively.
export async function down(): Promise<void> {
  return
}
