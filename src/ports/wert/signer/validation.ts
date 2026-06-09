import { Interface } from 'ethers'
import { ContractName, getContract } from 'decentraland-transactions'
import { getEthereumChainId, getPolygonChainId } from '../../../logic/chainIds'
import { Target } from '../types'
import { InvalidWertMessageError } from './errors'
import { WertMessage } from './types'

/**
 * The set of contracts and contract functions that the server is willing to sign a Wert
 * smart-contract order for, grouped by target.
 *
 * - `DEFAULT` covers the marketplace MANA-name purchase flow, which calls `register` on the
 *   `DCLControllerV2` contract.
 * - `PUBLICATION_FEES` covers the builder collection publication flow, which calls
 *   `createCollection` on the `CollectionManager` contract.
 */
type WertTargetRules = {
  allowedContractAddresses: Set<string>
  allowedFunctionSelectors: Set<string>
}

/**
 * Builds the case-insensitive set of allowed contract addresses for a target from the address
 * resolved via `decentraland-transactions` plus an optional comma-separated env override. The
 * override lets non-production environments allowlist additional contracts (e.g. the dev fiat
 * names controller) without code changes.
 */
function buildAllowedAddresses(resolvedAddress: string, envOverride: string | undefined): Set<string> {
  const extraAddresses = (envOverride ?? '')
    .split(',')
    .map(address => address.trim().toLowerCase())
    .filter(Boolean)
  return new Set([resolvedAddress.toLowerCase(), ...extraAddresses])
}

/**
 * Resolves the 4-byte function selector for a function name from a contract ABI.
 */
function getFunctionSelector(abi: object[], functionName: string): string {
  const fragment = new Interface(abi as ConstructorParameters<typeof Interface>[0]).getFunction(functionName)
  if (!fragment) {
    throw new Error(`The function "${functionName}" was not found in the provided ABI`)
  }
  return fragment.selector.toLowerCase()
}

/**
 * Resolves the signing rules for the given target. Contract addresses and selectors are derived
 * from `decentraland-transactions` using the chain ids the server is configured for, so they stay
 * in sync with the official Decentraland deployments.
 */
function getRulesForTarget(target: Target): WertTargetRules {
  switch (target) {
    case Target.PUBLICATION_FEES: {
      const contract = getContract(ContractName.CollectionManager, getPolygonChainId())
      return {
        allowedContractAddresses: buildAllowedAddresses(contract.address, process.env.WERT_PUBLICATION_FEES_ALLOWED_CONTRACTS),
        allowedFunctionSelectors: new Set([getFunctionSelector(contract.abi, 'createCollection')])
      }
    }
    case Target.DEFAULT:
    default: {
      const contract = getContract(ContractName.DCLControllerV2, getEthereumChainId())
      return {
        allowedContractAddresses: buildAllowedAddresses(contract.address, process.env.WERT_DEFAULT_ALLOWED_CONTRACTS),
        allowedFunctionSelectors: new Set([getFunctionSelector(contract.abi, 'register')])
      }
    }
  }
}

/**
 * Extracts the 4-byte function selector (`0x` + 8 hex chars) from the calldata that Wert will send
 * on-chain, or `undefined` when the calldata is missing or too short to contain a selector.
 */
function getCalldataSelector(scInputData: string | undefined): string | undefined {
  if (!scInputData || typeof scInputData !== 'string') {
    return undefined
  }
  const normalized = scInputData.startsWith('0x') ? scInputData : `0x${scInputData}`
  if (normalized.length < 10) {
    return undefined
  }
  return normalized.slice(0, 10).toLowerCase()
}

/**
 * Asserts that a Wert message only asks the server to sign a transaction against an allowlisted
 * Decentraland contract and function for the given target. The signature the server produces
 * authorizes Wert to broadcast `sc_input_data` to `sc_address`, so without this check any
 * authenticated user could obtain a Decentraland-signed order for an arbitrary contract call.
 *
 * @param message - The Wert message to be signed.
 * @param target - The signing target (defaults to {@link Target.DEFAULT} when not provided).
 * @throws {InvalidWertMessageError} When the contract address or function selector is not allowed.
 */
export function validateWertMessage(message: WertMessage, target?: Target): void {
  const effectiveTarget = target === Target.PUBLICATION_FEES ? Target.PUBLICATION_FEES : Target.DEFAULT
  const rules = getRulesForTarget(effectiveTarget)

  const scAddress = message.sc_address?.toLowerCase()
  if (!scAddress || !rules.allowedContractAddresses.has(scAddress)) {
    throw new InvalidWertMessageError(`The contract address "${message.sc_address}" is not allowed for the "${effectiveTarget}" target`)
  }

  const selector = getCalldataSelector(message.sc_input_data)
  if (!selector || !rules.allowedFunctionSelectors.has(selector)) {
    throw new InvalidWertMessageError(`The requested contract call is not allowed for the "${effectiveTarget}" target`)
  }
}
