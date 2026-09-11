/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from 'node-pg-migrate'

const SCHEMA = 'marketplace'

// Creator-signed discount coupons for the Shop. A coupon is an off-chain EIP-712 signature stored like a
// trade; the chain only learns about it when a buyer applies it. `coupon_state` mirrors what the CouponManager
// reports for each one (uses consumed, cancelled), refreshed by a poller.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    { schema: SCHEMA, name: 'coupons' },
    {
      id: { type: 'uuid', notNull: true, primaryKey: true, default: pgm.func('public.uuid_generate_v4()') },
      network: { type: 'text', notNull: true },
      chain_id: { type: 'integer', notNull: true },
      signer: { type: 'varchar(42)', notNull: true },
      signature: { type: 'text', notNull: true, unique: true },
      hashed_signature: { type: 'text', notNull: true, unique: true },
      // keccak256(abi.encode(signer, keccak256(signature))): the slot the CouponManager keys uses and cancellations on.
      state_key: { type: 'text', notNull: true, unique: true },
      coupon_manager: { type: 'varchar(42)', notNull: true },
      coupon_address: { type: 'varchar(42)', notNull: true },
      checks: { type: 'jsonb', notNull: true },
      discount_type: { type: 'smallint', notNull: true },
      discount_ppm: { type: 'integer', notNull: true },
      root: { type: 'text', notNull: true },
      collections: { type: 'text[]', notNull: true },
      effective_since: { type: 'timestamptz(3)', notNull: true },
      expires_at: { type: 'timestamptz(3)', notNull: true },
      created_at: { type: 'timestamptz(3)', notNull: true, default: pgm.func('now()::timestamptz(3)') }
    }
  )
  pgm.addConstraint({ schema: SCHEMA, name: 'coupons' }, 'coupons_discount_ppm_within_bounds', {
    check: 'discount_ppm BETWEEN 50000 AND 700000'
  })
  pgm.addConstraint({ schema: SCHEMA, name: 'coupons' }, 'coupons_effective_before_expiry', {
    check: 'effective_since < expires_at'
  })

  pgm.createIndex({ schema: SCHEMA, name: 'coupons' }, 'signer')
  pgm.createIndex({ schema: SCHEMA, name: 'coupons' }, 'expires_at')
  pgm.createIndex({ schema: SCHEMA, name: 'coupons' }, 'collections', { method: 'gin' })

  pgm.createTable(
    { schema: SCHEMA, name: 'coupon_state' },
    {
      coupon_id: {
        type: 'uuid',
        notNull: true,
        primaryKey: true,
        references: { schema: SCHEMA, name: 'coupons' },
        onDelete: 'CASCADE'
      },
      uses: { type: 'integer', notNull: true, default: 0 },
      cancelled: { type: 'boolean', notNull: true, default: false },
      // The signature indexes have moved past the ones the coupon was signed with, so the contract
      // refuses it even though it was never cancelled one by one.
      revoked: { type: 'boolean', notNull: true, default: false },
      checked_at: { type: 'timestamptz(3)', notNull: true, default: pgm.func('now()::timestamptz(3)') }
    }
  )

  // The catalogue reads these through the reader role the trades view already grants to; a table created
  // after that grant is not covered by it.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mv_trades_owner') THEN
        EXECUTE 'GRANT SELECT ON ${SCHEMA}.coupons, ${SCHEMA}.coupon_state TO mv_trades_owner';
      END IF;
    END
    $$;
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable({ schema: SCHEMA, name: 'coupon_state' })
  pgm.dropTable({ schema: SCHEMA, name: 'coupons' })
}
