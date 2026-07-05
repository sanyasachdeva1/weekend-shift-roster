import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const output = "dist";
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ["index.html", "styles.css", "app.js", "backend.js", "roster-engine.js", ".nojekyll"]) {
  await cp(file, `${output}/${file}`);
}
const config = {
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  siteUrl: process.env.SITE_URL || "",
};
await writeFile(`${output}/config.js`, `window.ROSTER_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
