import etag from 'etag'
import { ethers } from 'ethers'
import { isErrorWithMessage } from '../../logic/errors'
import { Params } from '../../logic/http/params'
import { ResourceStats, StatsCategory } from '../../ports/stats/types'
import { HandlerContextWithPath, StatusCode } from '../../types'

const MAX_AGE = 3600 // 1 HOUR

export async function getStatsHandler(
  context: Pick<HandlerContextWithPath<'stats', '/v1/stats/:category/:stat'>, 'components' | 'url' | 'params'>
) {
  try {
    const {
      components: { stats }
    } = context

    const params = new Params(context.url.searchParams)
    const { category, stat } = context.params
    const isOnSale = params.getBoolean('isOnSale')

    const adjacentToRoad = params.getBoolean('adjacentToRoad')
    const minDistanceToPlaza = params.getNumber('minDistanceToPlaza')
    const maxDistanceToPlaza = params.getNumber('maxDistanceToPlaza')
    const maxEstateSize = params.getNumber('maxEstateSize')
    const minEstateSize = params.getNumber('minEstateSize')
    const minPrice = params.getString('minPrice')
    const maxPrice = params.getString('maxPrice')

    const data = await stats.fetch(
      {
        category: category as StatsCategory,
        stat: stat as unknown as ResourceStats
      },
      {
        isOnSale,
        adjacentToRoad,
        minDistanceToPlaza,
        maxDistanceToPlaza,
        maxEstateSize,
        minEstateSize,
        maxPrice: maxPrice ? ethers.parseEther(maxPrice).toString() : undefined,
        minPrice: minPrice ? ethers.parseEther(minPrice).toString() : undefined
      }
    )

    const dataString = JSON.stringify(data)

    return {
      status: StatusCode.OK,
      headers: {
        'Cache-Control': `public,max-age=${MAX_AGE},s-maxage=${MAX_AGE}`,
        'Content-Type': 'application/json',
        'Last-Modified': new Date().toUTCString(),
        etag: etag(dataString),
        'content-length': dataString.length.toString()
      },
      body: {
        data
      }
    }
  } catch (e) {
    return {
      status: StatusCode.BAD_REQUEST,
      body: {
        ok: false,
        message: isErrorWithMessage(e) ? e.message : 'Could not fetch prices'
      }
    }
  }
}
