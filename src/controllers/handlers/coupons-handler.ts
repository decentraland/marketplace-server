import { isErrorWithMessage } from '../../logic/errors'
import { isEthereumAddressValid } from '../../logic/ethereum/validations'
import { getParameter } from '../../logic/http'
import { Coupon, CouponCreation } from '../../ports/coupons'
import {
  CouponAlreadyUnusableError,
  CouponNotFoundError,
  DuplicateCouponError,
  InvalidCouponAddressError,
  InvalidCouponChecksError,
  InvalidCouponCollectionsError,
  InvalidCouponDiscountError,
  InvalidCouponSignatureError,
  InvalidCouponSignatureIndexError,
  InvalidCouponNetworkError,
  InvalidCouponSignerError,
  NotCollectionCreatorError,
  UnsupportedCouponChainError
} from '../../ports/coupons/errors'
import { HTTPResponse, HandlerContextWithPath, StatusCode } from '../../types'

export async function addCouponHandler(
  context: Pick<HandlerContextWithPath<'coupons' | 'logs', '/v1/coupons'>, 'components' | 'request' | 'verification'>
): Promise<HTTPResponse<Coupon>> {
  const {
    request,
    components: { coupons, logs },
    verification
  } = context
  const logger = logs.getLogger('Coupons handler')

  const signer = verification?.auth
  if (!signer) {
    return { status: StatusCode.UNAUTHORIZED, body: { ok: false, message: 'Unauthorized' } }
  }

  const body: CouponCreation = await request.json()

  try {
    const data = await coupons.addCoupon(body, signer)
    return { status: StatusCode.CREATED, body: { ok: true, data } }
  } catch (e) {
    if (
      e instanceof InvalidCouponSignerError ||
      e instanceof InvalidCouponNetworkError ||
      e instanceof CouponAlreadyUnusableError ||
      e instanceof UnsupportedCouponChainError ||
      e instanceof InvalidCouponAddressError ||
      e instanceof InvalidCouponDiscountError ||
      e instanceof InvalidCouponCollectionsError ||
      e instanceof InvalidCouponChecksError ||
      e instanceof InvalidCouponSignatureError ||
      e instanceof InvalidCouponSignatureIndexError ||
      e instanceof NotCollectionCreatorError
    ) {
      return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: e.message } }
    }
    if (e instanceof DuplicateCouponError) {
      return { status: StatusCode.CONFLICT, body: { ok: false, message: e.message } }
    }
    logger.error(`Could not create the coupon: ${isErrorWithMessage(e) ? e.message : String(e)}`)
    return { status: StatusCode.ERROR, body: { ok: false, message: 'Coupon could not be created' } }
  }
}

/** GET /v1/coupons?signer=0x... -- a creator's coupons, newest first, with their last known on-chain state. */
export async function getCouponsHandler(
  context: Pick<HandlerContextWithPath<'coupons' | 'logs', '/v1/coupons'>, 'components' | 'url'>
): Promise<HTTPResponse<Coupon[]>> {
  const {
    components: { coupons, logs },
    url
  } = context
  const logger = logs.getLogger('Coupons handler')

  const signer = getParameter('signer', url.searchParams)
  if (!signer || !isEthereumAddressValid(signer)) {
    return { status: StatusCode.BAD_REQUEST, body: { ok: false, message: 'A valid signer address is required' } }
  }

  try {
    const data = await coupons.getCouponsBySigner(signer)
    return { status: StatusCode.OK, body: { ok: true, data } }
  } catch (e) {
    logger.error(`Could not fetch the coupons: ${isErrorWithMessage(e) ? e.message : String(e)}`)
    return { status: StatusCode.ERROR, body: { ok: false, message: 'Could not fetch the coupons' } }
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getCouponHandler(
  context: Pick<HandlerContextWithPath<'coupons' | 'logs', '/v1/coupons/:id'>, 'components' | 'params'>
): Promise<HTTPResponse<Coupon>> {
  const {
    components: { coupons, logs },
    params: { id }
  } = context
  const logger = logs.getLogger('Coupons handler')

  // The column is a uuid, so anything else fails the cast in Postgres rather than returning no rows.
  if (!UUID_PATTERN.test(id)) {
    return { status: StatusCode.NOT_FOUND, body: { ok: false, message: `Coupon not found for id ${id}` } }
  }

  try {
    const data = await coupons.getCoupon(id)
    return { status: StatusCode.OK, body: { ok: true, data } }
  } catch (e) {
    if (e instanceof CouponNotFoundError) {
      return { status: StatusCode.NOT_FOUND, body: { ok: false, message: e.message } }
    }
    logger.error(`Could not fetch the coupon: ${isErrorWithMessage(e) ? e.message : String(e)}`)
    return { status: StatusCode.ERROR, body: { ok: false, message: 'Could not fetch the coupon' } }
  }
}
