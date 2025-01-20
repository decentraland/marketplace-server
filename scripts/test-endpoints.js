const endpoints = {
  HOMEPAGE: {
    sales: ['/v1/sales?category=wearable&first=7&sortBy=recently_sold'],
    nfts: [
      '/v1/nfts?first=24&skip=0&sortBy=newest',
      '/v1/nfts?first=24&skip=0&sortBy=recently_listed&isOnSale=true&isLand=true',
      '/v1/nfts?first=24&skip=0&sortBy=recently_listed&category=wearable&isOnSale=true',
      '/v1/nfts?first=24&skip=0&sortBy=recently_listed&category=ens&isOnSale=true',
      '/v1/nfts?first=1000&skip=0&owner=0x747c6f502272129bf1ba872a1903045b837ee86c&isOnSale=true',
      '/v1/nfts?first=1000&skip=0&sortBy=newest&owner=0x747c6f502272129bf1ba872a1903045b837ee86c&isLand=true&rentalStatus=open&rentalStatus=cancelled&rentalStatus=executed'
    ],
    catalog: ['/v2/catalog?first=24&category=wearable&sortBy=newest'],
    items: ['/v1/items?contractAddress=0x07d03ca2c27f29ec3c4cf3afad857c5af13f61cd&itemId=9']
  },
  BROWSE: {
    prices: ['/v1/prices?category=wearable&assetType=item'],
    catalog: [
      '/v2/catalog?first=24&category=wearable&isOnSale=true&sortBy=newest',
      '/v2/catalog?first=24&category=wearable&isOnSale=true&sortBy=recently_sold',
      '/v2/catalog?first=24&category=wearable&isOnSale=true&sortBy=cheapest',
      '/v2/catalog?first=24&category=wearable&isOnSale=true&sortBy=most_expensive'
    ]
  },
  ITEM_DETAIL_PAGE: {
    items: ['/v1/items?contractAddress=0x2e4615470f56bbb5780262b9297bc4e968e8fb3e&itemId=0'],
    orders: ['/v1/orders?first=5&contractAddress=0x2e4615470f56bbb5780262b9297bc4e968e8fb3e&status=open&itemId=0&sortBy=cheapest'],
    sales: ['/v1/sales?contractAddress=0x2e4615470f56bbb5780262b9297bc4e968e8fb3e&first=5&skip=0&itemId=0'],
    bids: ['/v1/bids?contractAddress=0x2e4615470f56bbb5780262b9297bc4e968e8fb3e&itemId=0&status=open']
  }
}

const BASE_URL = 'http://localhost:5000' // adjust to the local server port
const PROD_URL = 'https://marketplace-api.decentraland.org' // adjust to the production server port 
const SLOW_THRESHOLD = 1000 // 1 second in milliseconds
const slowQueries = []
const fastQueries = []
const results = {
  localWins: 0,
  prodWins: 0,
  ties: 0,
  details: []
}

async function testEndpoint(endpoint, category) {
  const localUrl = encodeURI(`${BASE_URL}${endpoint}`)
  const prodEndpoint = category === 'catalog' ? endpoint.replace('/v2/', '/v1/') : endpoint
  const prodUrl = encodeURI(`${PROD_URL}${prodEndpoint}`)
  
  console.log(`\nTesting: ${endpoint}`)

  try {
    // Test local endpoint
    const localStart = performance.now()
    const localResponse = await fetch(localUrl)
    const localEnd = performance.now()
    const localDuration = (localEnd - localStart)
    
    // Test production endpoint
    const prodStart = performance.now()
    const prodResponse = await fetch(prodUrl)
    const prodEnd = performance.now()
    const prodDuration = (prodEnd - prodStart)

    // Format durations
    const localDurationSec = (localDuration / 1000).toFixed(3)
    const prodDurationSec = (prodDuration / 1000).toFixed(3)

    // Check status codes
    const localStatus = localResponse.status
    const prodStatus = prodResponse.status
    const localStatusIcon = localStatus >= 200 && localStatus < 300 ? '✅' : '❌'
    const prodStatusIcon = prodStatus >= 200 && prodStatus < 300 ? '✅' : '❌'

    // Determine winner (only if both responses were successful)
    let winner
    const difference = Math.abs(localDuration - prodDuration)
    const diffSec = (difference / 1000).toFixed(3)

    if (localStatus >= 200 && localStatus < 300 && prodStatus >= 200 && prodStatus < 300) {
      if (localDuration < prodDuration) {
        winner = 'LOCAL WINS 🏆'
        results.localWins++
      } else if (localDuration > prodDuration) {
        winner = 'PROD WINS 🏆'
        results.prodWins++
      } else {
        winner = 'TIE 🤝'
        results.ties++
      }
    } else {
      winner = 'NO WINNER - Invalid Response'
    }

    console.log(`Local  ${localStatusIcon} Status: ${localStatus} ⏱️  Time: ${localDurationSec}s`)
    console.log(`Prod   ${prodStatusIcon} Status: ${prodStatus} ⏱️  Time: ${prodDurationSec}s`)
    console.log(`${winner}${winner !== 'NO WINNER - Invalid Response' ? ` (diff: ${diffSec}s)` : ''}`)

    // Store result details
    results.details.push({
      endpoint,
      winner,
      diffSec,
      localStatus,
      prodStatus
    })

    // Track local queries only if successful
    if (localStatus >= 200 && localStatus < 300) {
      const queryInfo = {
        endpoint,
        duration: localDuration,
        status: localStatus
      }

      if (localDuration > SLOW_THRESHOLD) {
        slowQueries.push(queryInfo)
      } else {
        fastQueries.push(queryInfo)
      }
    }

  } catch (error) {
    console.error(`❌ Error: ${error.message}`)
  }
}

async function runTests() {
  console.log('Starting endpoint tests...\n')

  for (const [page, pageEndpoints] of Object.entries(endpoints)) {
    console.log(`\n=== Testing ${page} page endpoints ===`)
    for (const [category, urls] of Object.entries(pageEndpoints)) {
      console.log(`\n--- ${category.toUpperCase()} ---`)
      for (const url of urls) {
        await testEndpoint(url, category)
      }
    }
  }

  // Print performance summary for local endpoints only
  console.log('\n=== Local Environment Performance Summary ===')
  
  console.log('\nSlow Queries (>1s):')
  slowQueries.sort((a, b) => b.duration - a.duration)
  slowQueries.forEach(query => {
    const duration = query.duration / 1000
    console.log(`${duration.toFixed(3)}s - ${query.endpoint}`)
  })

  console.log('\nFast Queries (<1s):')
  fastQueries.sort((a, b) => a.duration - b.duration)
  fastQueries.forEach(query => {
    const duration = query.duration / 1000
    console.log(`${duration.toFixed(3)}s - ${query.endpoint}`)
  })

  // Print overall winner summary
  console.log('\n=== Overall Winner Summary ===')
  console.log(`Local Wins: ${results.localWins}`)
  console.log(`Prod Wins: ${results.prodWins}`)
  console.log(`Ties: ${results.ties}`)

  console.log('\n=== Detailed Results ===')
  results.details.forEach(detail => {
    const localStatusIcon = detail.localStatus >= 200 && detail.localStatus < 300 ? '✅' : '❌'
    const prodStatusIcon = detail.prodStatus >= 200 && detail.prodStatus < 300 ? '✅' : '❌'
    
    console.log(
      `${detail.endpoint}\n` +
      `  Local ${localStatusIcon} [${detail.localStatus}] | Prod ${prodStatusIcon} [${detail.prodStatus}]` +
      `  ${detail.winner}${detail.winner !== 'NO WINNER - Invalid Response' ? ` (diff: ${detail.diffSec}s)` : ''}`
    )
  })
}

// Run the tests
runTests().then(() => {
  console.log('\nAll tests completed!')
})
