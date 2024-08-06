import SQL from 'sql-template-strings'

export function getItemByItemIdQuery(contractAddress: string, itemId: string) {
  return SQL`
    select
      item.id,
      item.image,
      item.uri,
      coalesce(wearable.category, emote.category) as category,
      item.blockchain_id as item_id,
      item.collection_id as contract_address,
      coalesce(wearable.rarity, emote.rarity) as rarity,
      item.price,
      item.available,
      item.creator,
      item.beneficiary,
      item.created_at,
      item.updated_at,
      item.reviewed_at,
      item.sold_at,
      item.urn,
	    coalesce(wearable.name, emote.name) as name
    from
      squid_marketplace.item item
    left join squid_marketplace.metadata metadata on
      item.metadata_id = metadata.id
    left join squid_marketplace.emote emote on
      metadata.emote_id = emote.id
    left join squid_marketplace.wearable wearable on
      metadata.wearable_id = wearable.id
    where item.blockchain_id::text = ${itemId} AND item.collection_id = ${contractAddress};`
}
