// Respaldo manual de la base de datos (RNF-10): npm run backup
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const src = path.join(process.cwd(), "data", "bar.db");
if (!fs.existsSync(src)) {
  console.error("No existe data/bar.db. Inicie el sistema al menos una vez.");
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = path.join(process.cwd(), "data", "backups");
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, `bar-${stamp}.db`);
const db = new DatabaseSync(src);
db.prepare("VACUUM INTO ?").run(target);
db.close();
console.log(`Respaldo creado: ${path.relative(process.cwd(), target)}`);
