import { FetchEstateSizesQueryFragment } from './types'

export function consolidateSizes(estateSizes: FetchEstateSizesQueryFragment[]) {
  return estateSizes.reduce((acc, { size }) => {
    acc[size] = acc[size] ? acc[size] + 1 : 1
    return acc
  }, {} as Record<string, number>)
}
