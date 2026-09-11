import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { AbiCoder, getBytes, keccak256 } from 'ethers'

/**
 * The Merkle tree a CollectionDiscountCoupon is verified against: one leaf per collection address, hashed
 * the way the contract hashes it — keccak256(bytes.concat(keccak256(abi.encode(address)))) — which is
 * OpenZeppelin's standard leaf for the single-value type `['address']`.
 *
 * The tree is built with OpenZeppelin's StandardMerkleTree rather than by hand. The contract only calls
 * MerkleProof.verify, which folds a proof without caring how the tree was laid out, so any self-consistent
 * tree settles on-chain — but the root is a contract between whoever signs the coupon and whoever rebuilds
 * it here, and a hand-rolled tree that carries odd nodes up diverges from StandardMerkleTree at five, seven
 * and nine leaves while agreeing at four, six and eight. Sharing one library across both sides is what
 * keeps a creator who picks five collections from being rejected while four or six work.
 *
 * Leaves are de-duplicated and lower-cased before building, so the root is a function of the SET of
 * collections and not of the order or the casing a client happened to send.
 */

const COLLECTION_LEAF_ENCODING = ['address']

function uniqueCollections(collections: string[]): string[] {
  return [...new Set(collections.map(collection => collection.toLowerCase()))]
}

function buildTree(collections: string[]): StandardMerkleTree<string[]> {
  const unique = uniqueCollections(collections)
  if (unique.length === 0) {
    throw new Error('A coupon must cover at least one collection')
  }
  return StandardMerkleTree.of(
    unique.map(collection => [collection]),
    COLLECTION_LEAF_ENCODING
  )
}

/** The leaf the contract computes for a collection, spelled out as the contract spells it. */
export function collectionLeaf(collection: string): string {
  const encoded = AbiCoder.defaultAbiCoder().encode(['address'], [collection.toLowerCase()])
  return keccak256(getBytes(keccak256(encoded)))
}

/** The root for a set of collections. Throws on an empty set: a coupon has to cover something. */
export function collectionsRoot(collections: string[]): string {
  return buildTree(collections).root
}

/** The proof the buyer passes in `callerData` for one collection of the set. Empty for a one-collection coupon. */
export function collectionProof(collections: string[], collection: string): string[] {
  const tree = buildTree(collections)
  try {
    return tree.getProof([collection.toLowerCase()])
  } catch (error) {
    throw new Error(`The collection ${collection} is not covered by this coupon`)
  }
}

/** Recomputes the root from a leaf and its proof, the way the contract does. Exposed so tests and tools can check a proof. */
export function verifyCollectionProof(root: string, collection: string, proof: string[]): boolean {
  return StandardMerkleTree.verify(root, COLLECTION_LEAF_ENCODING, [collection.toLowerCase()], proof)
}
