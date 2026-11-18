import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
const sqlHost = process.env.SQL_HOST;
const sqlDbName = process.env.SQL_DB_NAME;
const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER;
const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD;

if (!databaseUrl) {
  if (!sqlHost) {
    throw new Error("DATABASE_URL or SQL_HOST must be set in environment variables.");
  }
  if (!sqlDbName) {
    throw new Error("DATABASE_URL or SQL_DB_NAME must be set in environment variables.");
  }
  if (!user) {
    throw new Error("DATABASE_URL or SQL_ADMIN_USER must be set in environment variables.");
  }
  if (!password) {
    throw new Error("DATABASE_URL or SQL_ADMIN_PASSWORD must be set in environment variables.");
  }
  console.log(`Using user: ${user} to connect to database.`);
} else {
  console.log("Using DATABASE_URL for Drizzle Kit migrations.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: databaseUrl
    ? {
        url: databaseUrl,
      }
    : {
        host: sqlHost!,
        port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : undefined,
        user: user!,
        password: password!,
        database: sqlDbName!,
        ssl: false,
      },
  verbose: true,
});
