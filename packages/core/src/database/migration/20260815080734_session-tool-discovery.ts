import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260815080734_session-tool-discovery",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_tool_discovery_call\` (
          \`session_id\` text NOT NULL,
          \`assistant_message_id\` text NOT NULL,
          \`tool_call_id\` text NOT NULL,
          \`query\` text NOT NULL,
          \`limit\` integer NOT NULL,
          \`catalog_revision\` text NOT NULL,
          \`matches\` text NOT NULL,
          \`pending_sources\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_completed\` integer NOT NULL,
          CONSTRAINT \`session_tool_discovery_call_pk\` PRIMARY KEY(\`session_id\`, \`assistant_message_id\`, \`tool_call_id\`),
          CONSTRAINT \`fk_session_tool_discovery_call_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_tool_discovery\` (
          \`session_id\` text NOT NULL,
          \`tool_key\` text NOT NULL,
          \`definition_hash\` text NOT NULL,
          \`callable_name\` text NOT NULL,
          \`source\` text NOT NULL,
          \`discovered_seq\` integer NOT NULL,
          \`time_discovered\` integer NOT NULL,
          CONSTRAINT \`session_tool_discovery_pk\` PRIMARY KEY(\`session_id\`, \`tool_key\`),
          CONSTRAINT \`fk_session_tool_discovery_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_tool_discovery_session_seq_idx\` ON \`session_tool_discovery\` (\`session_id\`,\`discovered_seq\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
