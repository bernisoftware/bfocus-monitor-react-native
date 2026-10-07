// Copia o motor de envio do pacote Node (a fonte, monitor/node/src/engine.ts) para src/engine.ts.
// O motor não usa API de plataforma (só fetch/setTimeout/Date), por isso serve aos dois. No
// monorepo, test/engine-sync.test.ts FALHA se a cópia divergir. No espelho público, só a cópia existe.
//   npm run sync:engine
import { copyFileSync, existsSync } from "node:fs";

const source = new URL("../../node/src/engine.ts", import.meta.url);
const target = new URL("../src/engine.ts", import.meta.url);

if (!existsSync(source)) {
  console.error("✗ monitor/node/src/engine.ts não encontrado (rode no monorepo).");
  process.exit(1);
}
copyFileSync(source, target);
console.log("✓ src/engine.ts atualizado a partir de monitor/node");
