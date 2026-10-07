/**
 * src/engine.ts é CÓPIA do motor do pacote Node (monitor/node/src/engine.ts). No monorepo, esta
 * suíte falha se a cópia divergir — rode `npm run sync:engine`. No espelho público, pula.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const SOURCE = new URL("../../node/src/engine.ts", import.meta.url);
const COPY = new URL("../src/engine.ts", import.meta.url);

describe("motor", () => {
  it("src/engine.ts é igual a monitor/node/src/engine.ts", { skip: !existsSync(SOURCE) && "espelho público: sem o pacote Node" }, () => {
    assert.equal(readFileSync(COPY, "utf8"), readFileSync(SOURCE, "utf8"), "cópia divergente: rode `npm run sync:engine`");
  });
});
