import { ChainId } from '@dcl/schemas'

export const strategiesByChainId = {
  [ChainId.ETHEREUM_MAINNET]: [
    {
      name: 'multichain',
      network: '1',
      params: {
        name: 'multichain',
        graphs: {
          [ChainId.MATIC_MAINNET]: 'https://api.thegraph.com/subgraphs/name/decentraland/blocks-matic-mainnet'
        },
        symbol: 'MANA',
        strategies: [
          {
            name: 'erc20-balance-of',
            params: {
              address: '0x0f5d2fb29fb7d3cfee444a200298f468908cc942',
              decimals: 18
            },
            network: '1'
          },
          {
            name: 'erc20-balance-of',
            params: {
              address: '0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4',
              decimals: 18
            },
            network: '137'
          }
        ]
      }
    },
    {
      name: 'erc20-balance-of',
      network: '1',
      params: {
        symbol: 'WMANA',
        address: '0xfd09cf7cfffa9932e33668311c4777cb9db3c9be',
        decimals: 18
      }
    },
    {
      name: 'erc721-with-multiplier',
      network: '1',
      params: {
        symbol: 'LAND',
        address: '0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d',
        multiplier: 2000
      }
    },
    {
      name: 'decentraland-estate-size',
      network: '1',
      params: {
        symbol: 'ESTATE',
        address: '0x959e104e1a4db6317fa58f8295f586e1a978c297',
        multiplier: 2000
      }
    },
    {
      name: 'erc721-with-multiplier',
      network: '1',
      params: {
        symbol: 'NAMES',
        address: '0x2a187453064356c898cae034eaed119e1663acb8',
        multiplier: 100
      }
    }
  ],
  [ChainId.ETHEREUM_GOERLI]: [
    {
      name: 'multichain',
      network: '5',
      params: {
        name: 'multichain',
        graphs: {
          [ChainId.ETHEREUM_GOERLI]: 'https://api.thegraph.com/subgraphs/name/decentraland/blocks-ethereum-goerli',
          [ChainId.MATIC_MUMBAI]: 'https://api.thegraph.com/subgraphs/name/decentraland/blocks-matic-mumbai'
        },
        symbol: 'MANA',
        strategies: [
          {
            name: 'erc20-balance-of',
            params: {
              address: '0xe7fDae84ACaba2A5Ba817B6E6D8A2d415DBFEdbe',
              decimals: 18
            },
            network: '5'
          },
          {
            name: 'erc20-balance-of',
            params: {
              address: '0x882Da5967c435eA5cC6b09150d55E8304B838f45',
              decimals: 18
            },
            network: '80001'
          }
        ]
      }
    },
    {
      name: 'erc721-with-multiplier',
      network: '5',
      params: {
        symbol: 'LAND',
        address: '0x25b6B4bac4aDB582a0ABd475439dA6730777Fbf7',
        multiplier: 2000
      }
    },
    {
      name: 'decentraland-estate-size',
      network: '5',
      params: {
        symbol: 'ESTATE',
        address: '0xC9A46712E6913c24d15b46fF12221a79c4e251DC',
        multiplier: 2000
      }
    },
    {
      name: 'erc721-with-multiplier',
      network: '5',
      params: {
        symbol: 'NAMES',
        address: '0x6b8da2752827cf926215b43bb8E46Fd7b9dDac35',
        multiplier: 100
      }
    }
  ],
  [ChainId.ETHEREUM_SEPOLIA]: [
    {
      name: 'multichain',
      network: '11155111',
      params: {
        name: 'multichain',
        graphs: {
          [ChainId.ETHEREUM_SEPOLIA]: 'https://api.studio.thegraph.com/query/49472/blocks-ethereum-sepolia/version/latest',
          [ChainId.MATIC_MUMBAI]: 'https://api.thegraph.com/subgraphs/name/decentraland/blocks-matic-mumbai'
        },
        symbol: 'MANA',
        strategies: [
          {
            name: 'erc20-balance-of',
            params: {
              address: '0xfa04d2e2ba9aec166c93dfeeba7427b2303befa9',
              decimals: 18
            },
            network: '11155111'
          },
          {
            name: 'erc20-balance-of',
            params: {
              address: '0x882Da5967c435eA5cC6b09150d55E8304B838f45',
              decimals: 18
            },
            network: '80001'
          }
        ]
      }
    },
    {
      name: 'erc721-with-multiplier',
      network: '11155111',
      params: {
        symbol: 'LAND',
        address: '0x42f4ba48791e2de32f5fbf553441c2672864bb33',
        multiplier: 2000
      }
    },
    {
      name: 'decentraland-estate-size',
      network: '11155111',
      params: {
        symbol: 'ESTATE',
        address: '0x369a7fbe718c870c79f99fb423882e8dd8b20486',
        multiplier: 2000
      }
    },
    {
      name: 'erc721-with-multiplier',
      network: '11155111',
      params: {
        symbol: 'NAMES',
        address: '0x7518456ae93eb98f3e64571b689c626616bb7f30',
        multiplier: 100
      }
    }
  ]
}
