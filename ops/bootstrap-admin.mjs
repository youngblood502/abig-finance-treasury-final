#!/usr/bin/env node
// Creates the first system administrator. Run once after the first migration.
//   MIGRATION_DATABASE_URL=... node ops/bootstrap-admin.mjs admin@yourcompany.com "Full Name"
// The password is printed once; the person must change it at first sign-in.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword } from "./hash.mjs";

const [email, ...nameParts] = process.argv.slice(2); const name = nameParts.join(" ");
if (!process.env.MIGRATION_DATABASE_URL || !email || !name) { console.error('Usage: MIGRATION_DATABASE_URL=... node ops/bootstrap-admin.mjs email "Full Name"'); process.exit(2); }
const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", b = randomBytes(16);
const temp = [0, 1, 2, 3].map((g) => [0, 1, 2, 3].map((i) => alphabet[b[g * 4 + i] % alphabet.length]).join("")).join("-");
const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL }); await c.connect();
try {
  await c.query("INSERT INTO users (email, full_name, is_system_admin, password_hash, must_change_password) VALUES ($1,$2,true,$3,true)", [email.toLowerCase(), name, await hashPassword(temp)]);
  console.log(`Administrator created.\n  email:    ${email.toLowerCase()}\n  password: ${temp}   (temporary; shown only now)`);
} catch (e) { console.error(e.code === "23505" ? "That email already exists." : e.message); process.exit(1); } finally { await c.end(); }
