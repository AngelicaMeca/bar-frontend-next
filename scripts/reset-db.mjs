// Borra la base local para regenerar los datos de ejemplo en el próximo inicio: npm run db:reset
import fs from "node:fs";
import path from "node:path";

const base = path.join(process.cwd(), "data", "bar.db");
let removed = 0;
for (const f of [base, `${base}-wal`, `${base}-shm`]) {
  if (fs.existsSync(f)) {
    fs.unlinkSync(f);
    removed++;
  }
}
console.log(removed ? "Base eliminada. Se regenerará con datos de ejemplo al iniciar el sistema." : "No había base para eliminar.");
