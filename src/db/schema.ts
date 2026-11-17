import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull().default(''),
  name: text('name').notNull().default('Cricket Fan'),
  role: text('role').notNull().default('USER'), // 'USER' | 'ADMIN' | 'GATE_STAFF'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const stadiums = pgTable('stadiums', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  city: text('city').notNull(),
  country: text('country').notNull(),
  capacity: integer('capacity').notNull(),
  specJson: text('spec_json').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const seatCategories = pgTable('seat_categories', {
  id: serial('id').primaryKey(),
  stadiumId: integer('stadium_id')
    .references(() => stadiums.id)
    .notNull(),
  code: text('code').notNull(), // 'VIP_LOUNGE' | 'PAVILION_CLUB' | 'LOWER_BOWL' | 'UPPER_TIER' | 'HOSPITALITY_BOX'
  name: text('name').notNull(),
  colorHex: text('color_hex').notNull(),
  basePricePaise: integer('base_price_paise').notNull(),
  isCovered: boolean('is_covered').notNull().default(true),
  tierLevel: integer('tier_level').notNull().default(1),
});

export const stands = pgTable('stands', {
  id: serial('id').primaryKey(),
  stadiumId: integer('stadium_id')
    .references(() => stadiums.id)
    .notNull(),
  code: text('code').notNull(), // 'NORTH' | 'NORTH_EAST' | 'EAST' | 'SOUTH_EAST' | 'SOUTH' | 'SOUTH_WEST' | 'WEST' | 'NORTH_WEST'
  name: text('name').notNull(),
  orientationAngleDeg: doublePrecision('orientation_angle_deg').notNull(),
  tierCount: integer('tier_count').notNull().default(3),
});

export const blocks = pgTable('blocks', {
  id: serial('id').primaryKey(),
  stadiumId: integer('stadium_id')
    .references(() => stadiums.id)
    .notNull(),
  standId: integer('stand_id')
    .references(() => stands.id)
    .notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  tier: integer('tier').notNull(),
  rowCount: integer('row_count').notNull(),
  seatsPerRow: integer('seats_per_row').notNull(),
  elevationBaseM: doublePrecision('elevation_base_m').notNull(),
  rakeAngleDeg: doublePrecision('rake_angle_deg').notNull(),
});

export const seats = pgTable(
  'seats',
  {
    id: serial('id').primaryKey(),
    stadiumId: integer('stadium_id')
      .references(() => stadiums.id)
      .notNull(),
    standId: integer('stand_id')
      .references(() => stands.id)
      .notNull(),
    blockId: integer('block_id')
      .references(() => blocks.id)
      .notNull(),
    categoryId: integer('category_id')
      .references(() => seatCategories.id)
      .notNull(),
    seatCode: text('seat_code').notNull(),
    rowNumber: integer('row_number').notNull(),
    seatNumber: integer('seat_number').notNull(),
    instanceIndex: integer('instance_index').notNull(),
    posX: doublePrecision('pos_x').notNull(),
    posY: doublePrecision('pos_y').notNull(),
    posZ: doublePrecision('pos_z').notNull(),
    rotY: doublePrecision('rot_y').notNull(),
    distanceToPitchM: doublePrecision('distance_to_pitch_m').notNull(),
    distanceToBoundaryM: doublePrecision('distance_to_boundary_m').notNull(),
    elevationAngleDeg: doublePrecision('elevation_angle_deg').notNull(),
    horizontalAngleDeg: doublePrecision('horizontal_angle_deg').notNull(),
    scoreboardVisible: boolean('scoreboard_visible').notNull().default(true),
    obstructionWarning: text('obstruction_warning').notNull().default('NONE'),
    shadeAfternoonPct: integer('shade_afternoon_pct').notNull().default(65),
    viewQualityScore: integer('view_quality_score').notNull().default(85),
  },
  (table) => [
    uniqueIndex('uq_seats_stadium_code').on(table.stadiumId, table.seatCode),
    uniqueIndex('uq_seats_stadium_instance').on(table.stadiumId, table.instanceIndex),
    index('idx_seats_block').on(table.blockId),
  ]
);

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  primaryColor: text('primary_color').notNull(),
  secondaryColor: text('secondary_color').notNull(),
});

export const matches = pgTable('matches', {
  id: serial('id').primaryKey(),
  stadiumId: integer('stadium_id')
    .references(() => stadiums.id)
    .notNull(),
  homeTeamId: integer('home_team_id')
    .references(() => teams.id)
    .notNull(),
  awayTeamId: integer('away_team_id')
    .references(() => teams.id)
    .notNull(),
  tournament: text('tournament').notNull(),
  title: text('title').notNull(),
  startTime: timestamp('start_time').notNull(),
  status: text('status').notNull().default('UPCOMING'), // 'UPCOMING' | 'LIVE' | 'COMPLETED' | 'CANCELLED'
  demandMultiplier: doublePrecision('demand_multiplier').notNull().default(1.0),
  rivalryMultiplier: doublePrecision('rivalry_multiplier').notNull().default(1.0),
  weekendMultiplier: doublePrecision('weekend_multiplier').notNull().default(1.0),
  refundPolicyJson: text('refund_policy_json').notNull().default('{"fullRefundHoursBefore":48,"partialRefundPct":70}'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const matchSeatPricing = pgTable(
  'match_seat_pricing',
  {
    id: serial('id').primaryKey(),
    matchId: integer('match_id')
      .references(() => matches.id)
      .notNull(),
    categoryId: integer('category_id')
      .references(() => seatCategories.id)
      .notNull(),
    basePricePaise: integer('base_price_paise').notNull(),
    dynamicMultiplier: doublePrecision('dynamic_multiplier').notNull().default(1.0),
    finalPricePaise: integer('final_price_paise').notNull(),
  },
  (table) => [
    uniqueIndex('uq_match_category_pricing').on(table.matchId, table.categoryId),
  ]
);

export const seatInventory = pgTable(
  'seat_inventory',
  {
    id: serial('id').primaryKey(),
    matchId: integer('match_id')
      .references(() => matches.id)
      .notNull(),
    seatId: integer('seat_id')
      .references(() => seats.id)
      .notNull(),
    blockId: integer('block_id')
      .references(() => blocks.id)
      .notNull(),
    status: text('status').notNull().default('AVAILABLE'), // 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED'
    holdUserId: integer('hold_user_id').references(() => users.id),
    holdToken: text('hold_token'),
    holdExpiresAt: timestamp('hold_expires_at'),
    bookingId: integer('booking_id'),
    viewCount: integer('view_count').notNull().default(0),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_inventory_match_seat').on(table.matchId, table.seatId),
    index('idx_inventory_match_block_status').on(table.matchId, table.blockId, table.status),
    index('idx_inventory_hold_expiry').on(table.status, table.holdExpiresAt),
  ]
);

export const bookings = pgTable('bookings', {
  id: serial('id').primaryKey(),
  bookingReference: text('booking_reference').notNull().unique(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  matchId: integer('match_id')
    .references(() => matches.id)
    .notNull(),
  status: text('status').notNull().default('PENDING_PAYMENT'), // 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED'
  totalAmountPaise: integer('total_amount_paise').notNull(),
  seatCount: integer('seat_count').notNull(),
  holdToken: text('hold_token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  cancelledAt: timestamp('cancelled_at'),
  refundAmountPaise: integer('refund_amount_paise').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const bookingSeats = pgTable(
  'booking_seats',
  {
    id: serial('id').primaryKey(),
    bookingId: integer('booking_id')
      .references(() => bookings.id)
      .notNull(),
    matchId: integer('match_id')
      .references(() => matches.id)
      .notNull(),
    seatId: integer('seat_id')
      .references(() => seats.id)
      .notNull(),
    pricePaise: integer('price_paise').notNull(),
  },
  (table) => [
    uniqueIndex('uq_confirmed_match_seat').on(table.matchId, table.seatId),
  ]
);

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  bookingId: integer('booking_id')
    .references(() => bookings.id)
    .notNull(),
  razorpayOrderId: text('razorpay_order_id').notNull().unique(),
  razorpayPaymentId: text('razorpay_payment_id'),
  razorpaySignature: text('razorpay_signature'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  amountPaise: integer('amount_paise').notNull(),
  currency: text('currency').notNull().default('INR'),
  status: text('status').notNull().default('CREATED'), // 'CREATED' | 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'LATE_REFUND_INITIATED'
  webhookPayloadJson: text('webhook_payload_json').notNull().default('{}'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const tickets = pgTable('tickets', {
  id: serial('id').primaryKey(),
  ticketCode: text('ticket_code').notNull().unique(),
  bookingId: integer('booking_id')
    .references(() => bookings.id)
    .notNull(),
  matchId: integer('match_id')
    .references(() => matches.id)
    .notNull(),
  seatId: integer('seat_id')
    .references(() => seats.id)
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  qrSignedToken: text('qr_signed_token').notNull(),
  status: text('status').notNull().default('VALID'), // 'VALID' | 'USED' | 'CANCELLED'
  scannedAt: timestamp('scanned_at'),
  scannedByUserId: integer('scanned_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const scanLogs = pgTable('scan_logs', {
  id: serial('id').primaryKey(),
  ticketId: integer('ticket_id').references(() => tickets.id),
  matchId: integer('match_id').references(() => matches.id),
  scannedByUserId: integer('scanned_by_user_id').references(() => users.id),
  result: text('result').notNull(), // 'VALID' | 'DUPLICATE_SCAN' | 'INVALID_SIGNATURE' | 'WRONG_MATCH' | 'CANCELLED_TICKET'
  details: text('details').notNull(),
  scannedAt: timestamp('scanned_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  actorUserId: integer('actor_user_id').references(() => users.id),
  actorRole: text('actor_role').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  bookings: many(bookings),
  tickets: many(tickets),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  user: one(users, {
    fields: [bookings.userId],
    references: [users.id],
  }),
  match: one(matches, {
    fields: [bookings.matchId],
    references: [matches.id],
  }),
  bookingSeats: many(bookingSeats),
  tickets: many(tickets),
  payments: many(payments),
}));
