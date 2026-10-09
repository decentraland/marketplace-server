import { MigrationBuilder } from 'node-pg-migrate'

const SCHEMA = 'marketplace'
const TABLE = { schema: SCHEMA, name: 'favorite_discount_notifications' }

// One row per notification sent: it is both what keeps an item from being announced twice for the same
// coupon and what the per-user daily cap counts.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(TABLE, {
    user_address: { type: 'varchar(42)', notNull: true },
    contract_address: { type: 'varchar(42)', notNull: true },
    item_id: { type: 'text', notNull: true },
    coupon_id: { type: 'uuid', notNull: true, references: { schema: SCHEMA, name: 'coupons' }, onDelete: 'CASCADE' },
    sent_at: { type: 'timestamptz(3)', notNull: true, default: pgm.func('now()::timestamptz(3)') }
  })
  pgm.addConstraint(TABLE, 'favorite_discount_notifications_pkey', {
    primaryKey: ['user_address', 'contract_address', 'item_id', 'coupon_id']
  })
  pgm.createIndex(TABLE, [{ name: 'user_address' }, { name: 'sent_at', sort: 'DESC' }])
  pgm.createIndex(TABLE, 'coupon_id')

  // Null until the job has announced the coupon (or decided there is nothing to announce).
  pgm.addColumn({ schema: SCHEMA, name: 'coupons' }, { favorites_notified_at: { type: 'timestamptz(3)' } })
  // Discounts already running when this ships are not news any more: only the ones that start from now on
  // are announced.
  pgm.sql(`UPDATE ${SCHEMA}.coupons SET favorites_notified_at = now()`)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn({ schema: SCHEMA, name: 'coupons' }, 'favorites_notified_at')
  pgm.dropTable(TABLE)
}
