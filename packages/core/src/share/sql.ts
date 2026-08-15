import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/sql"
import { Timestamps } from "../database/schema.sql"

export const SessionShareTable = sqliteTable("session_share", {
  session_id: text()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  id: text().notNull(),
  secret: text().notNull(),
  url: text().notNull(),
  ...Timestamps,
})

// Intentionally has no Session foreign key: revocation credentials must
// survive the Session and session_share cascade until the remote delete lands.
export const SessionShareRevocationTable = sqliteTable(
  "session_share_revocation",
  {
    session_id: text().notNull(),
    directory: text().notNull(),
    id: text().notNull(),
    secret: text().notNull(),
    url: text().notNull(),
    attempt_count: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.session_id, table.id] })],
)

// A marker is written even when the Session has no live share. This closes
// the race where a remote create lands after deletion staging saw no share.
export const SessionShareRemovalTable = sqliteTable("session_share_removal", {
  session_id: text().primaryKey(),
  directory: text().notNull(),
  ...Timestamps,
})
