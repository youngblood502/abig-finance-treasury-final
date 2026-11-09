/** Next.js runs this at build time. Tailwind is only needed then, so it stays a development dependency. */
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
