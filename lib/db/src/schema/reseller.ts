import { createInsertSchema } from "drizzle-zod";
import {
  bigint,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  varchar,
  real,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const resellersTable = pgTable("resellers", {
  id: integer("id").primaryKey(),
  tgId: bigint("tg_id", { mode: "number" }).notNull(),
  title: varchar("title", { length: 80 }),
  totalGb: numeric("total_gb", { precision: 10, scale: 2 }).notNull(),
  usedGb: numeric("used_gb", { precision: 10, scale: 2 }).notNull(),
  isEnabled: smallint("is_enabled").notNull(),
  perGigPrice: integer("per_gig_price"),
  customerPricePerGb: numeric("customer_price_per_gb", { precision: 14, scale: 2 }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }),
});

export const resellerCustomersTable = pgTable("reseller_customers", {
  id: integer("id").primaryKey(),
  phone: varchar("phone", { length: 30 }).notNull(),
  fullName: varchar("full_name", { length: 120 }).notNull(),
  note: text("note"),
  rainUsername: varchar("rain_username", { length: 100 }),
  resellerTgId: bigint("reseller_tg_id", { mode: "number" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
});

export const resellerServicesTable = pgTable("reseller_services", {
  id: integer("id").primaryKey(),
  resellerTgId: bigint("reseller_tg_id", { mode: "number" }).notNull(),
  customerId: integer("customer_id").notNull(),
  gb: numeric("gb", { precision: 10, scale: 2 }).notNull(),
  days: integer("days").notNull(),
  label: varchar("label", { length: 64 }).notNull(),
  rainUsername: varchar("rain_username", { length: 80 }).notNull(),
  subscriptionUrl: text("subscription_url"),
  falcoConfigId: bigint("falco_config_id", { mode: "number" }),
  falcoSystemName: varchar("falco_system_name", { length: 128 }),
  falcoUsername: varchar("falco_username", { length: 128 }),
  falcoSubUrl: text("falco_sub_url"),
  expireAt: timestamp("expire_at", { mode: "date" }),
  status: text("status").notNull(),
  disabledAt: timestamp("disabled_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }),
  lastUsedBytes: bigint("last_used_bytes", { mode: "number" }),
  lastTotalBytes: bigint("last_total_bytes", { mode: "number" }),
  lastRemainingBytes: bigint("last_remaining_bytes", { mode: "number" }),
  adminNotes: text("admin_notes"),
  autoRenew: smallint("auto_renew"),
  nextPlanGb: real("next_plan_gb"),
  nextPlanDays: integer("next_plan_days"),
});

export const resellerSalesLogTable = pgTable("reseller_sales_log", {
  id: integer("id").primaryKey(),
  resellerTgId: bigint("reseller_tg_id", { mode: "number" }).notNull(),
  serviceId: integer("service_id").notNull(),
  actionType: varchar("action_type", { length: 10 }).notNull(),
  gbAmount: real("gb_amount").notNull(),
  daysAmount: integer("days_amount").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }),
  customSellPrice: integer("custom_sell_price"),
  isPaid: smallint("is_paid"),
});

export const webSessionsTable = pgTable("web_sessions", {
  id: text("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  role: text("role").notNull(),
  resellerId: integer("reseller_id"),
  displayName: text("display_name"),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const insertResellerSchema = createInsertSchema(resellersTable);
export const insertCustomerSchema = createInsertSchema(resellerCustomersTable);
export const insertServiceSchema = createInsertSchema(resellerServicesTable);
export const insertSaleSchema = createInsertSchema(resellerSalesLogTable);
export const insertWebSessionSchema = createInsertSchema(webSessionsTable);

export type Reseller = typeof resellersTable.$inferSelect;
export type Customer = typeof resellerCustomersTable.$inferSelect;
export type Service = typeof resellerServicesTable.$inferSelect;
export type Sale = typeof resellerSalesLogTable.$inferSelect;
export type WebSession = typeof webSessionsTable.$inferSelect;
export type AppRole = z.infer<typeof insertWebSessionSchema>["role"];