#!/usr/bin/env node
// DEVELOPMENT ONLY. Gives every demo user the same known password so the real sign-in screen can be tried.
import pg from "pg";
import { hashPassword } from "./hash.mjs";
if (process.env.NODE_ENV === "production") { console.error("Refusing to run in production."); process.exit(1); }
const pw = process.env.DEMO_PASSWORD ?? "demo-password-2026";
const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL }); await c.connect();
const r = await c.query("UPDATE users SET password_hash = $1, must_change_password = false, failed_logins = 0, locked_until = NULL WHERE email LIKE '%@abig.test'", [await hashPassword(pw)]);
console.log(`Set the password of ${r.rowCount} demo users (@abig.test) to: ${pw}`); await c.end();
