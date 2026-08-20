import type { Config } from "drizzle-kit";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  connectionString: "./db/omnishell.db",
} satisfies Config;
