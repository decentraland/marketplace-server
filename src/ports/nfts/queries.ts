import SQL from 'sql-template-strings'
import { Network } from '@dcl/schemas'
import { getDBNetworks } from '../../utils'

export function getNftByTokenIdQuery(contractAddress: string, tokenId: string, network: Network) {
  return SQL`
    select
      nft.id,
      nft.contract_address,
      nft.token_id,
      nft.network,
      nft.created_at,
      nft.token_uri as url,
      nft.updated_at,
      nft.sold_at,
      nft.urn,
      account.address as owner,
      nft.image,
      nft.issued_id,
      nft.item_id,
      nft.category,
      coalesce (wearable.rarity, emote.rarity, '') as rarity,
      coalesce (wearable.name, emote.name, land_data."name", ens.subdomain, concat(parcel.x, ', ', parcel.y)) as name
    from
      squid_marketplace.nft nft
    left join squid_marketplace.metadata metadata on
      nft.metadata_id = metadata.id
    left join squid_marketplace.wearable wearable on
      metadata.wearable_id = wearable.id
    left join squid_marketplace.emote emote on
      metadata.emote_id = emote.id
    left join squid_marketplace.parcel parcel on nft.id = parcel.id
    left join squid_marketplace.estate estate on nft.id = estate.id
    left join squid_marketplace.data land_data on (estate.data_id  = land_data.id or parcel.id = land_data.id)
    left join squid_marketplace.ens ens on ens.id = nft.ens_id 
    left join squid_marketplace.account account on nft.owner_id = account.id
    where
      nft.token_id::text = ${tokenId} and
      nft.network = ANY (${getDBNetworks(network)}) and
      nft.contract_address = ${contractAddress}
	`
}
