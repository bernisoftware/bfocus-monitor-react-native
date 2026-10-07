/** API do app: init, identidade, ErrorBoundary e rastro do Hermes/JSC. */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement, isValidElement } from "react";
import * as monitor from "@bfocus/monitor-react-native";
import { startServer, type TestServer } from "./helpers/server.js";

let server: TestServer | null = null;
afterEach(async () => {
  await monitor.close(100);
  await server?.close();
  server = null;
});

async function setup(opts: Partial<monitor.InitOptions> = {}) {
  server = await startServer();
  monitor.init({ key: "bf_mon_x", baseUrl: server.url, autoCapture: false, ...opts });
  return server;
}
const events = (s: TestServer) => s.requests.flatMap((r) => r.body.events);

describe("init e identidade", () => {
  it("chave vazia é erro de argumento imediato; antes do init nada lança", async () => {
    assert.throws(() => monitor.init({ key: "" }), TypeError);
    monitor.captureException(new Error("x"));
    monitor.setUser({ externalId: "u" });
    assert.equal(await monitor.flush(10), true);
  });

  it("sem rede no init; setUser com objetos (igual ao navegador); setUser() limpa", async () => {
    const s = await setup({ release: "1.0.0" });
    assert.equal(s.requests.length, 0);
    monitor.setUser({ externalId: "u-1", userHash: "v2.1.x" }, { externalId: "c-1" });
    monitor.captureException(new Error("com"));
    monitor.setUser();
    monitor.captureException(new Error("sem"));
    await monitor.flush(1000);
    const [a, b] = events(s);
    assert.deepEqual([a.user, a.customer], [{ externalId: "u-1", userHash: "v2.1.x" }, { externalId: "c-1" }]);
    assert.equal(b.user, undefined);
    assert.equal(b.customer, undefined);
    assert.equal(a.environment, "production");
  });

  it("exceção encadeada: a causa raiz vai como exceção", async () => {
    const s = await setup();
    monitor.captureException(new Error("tela de pedido", { cause: new SyntaxError("JSON inválido") }));
    await monitor.flush(1000);
    assert.equal(events(s)[0].exception.type, "SyntaxError");
    assert.equal(events(s)[0].exception.message, "JSON inválido (dentro de: Error: tela de pedido)");
  });
});

describe("ErrorBoundary", () => {
  it("vem no pacote principal, captura e mostra o fallback", async () => {
    const s = await setup();
    const b = new monitor.ErrorBoundary({ fallback: createElement("Text", null, "Algo deu errado") });
    const err = new Error("render");
    b.state = monitor.ErrorBoundary.getDerivedStateFromError(err);
    b.componentDidCatch(err, { componentStack: "" });
    assert.ok(isValidElement(b.render()));
    await monitor.flush(1000);
    assert.equal(events(s)[0].exception.message, "render");
  });
});

describe("parseStack", () => {
  it("Hermes em dev (bundle pelo Metro): sem query, de fora para dentro, native não é do sistema", () => {
    const stack = [
      "TypeError: Cannot read property 'total' of undefined",
      "    at calcTotal (http://10.0.2.2:8081/index.bundle?platform=android&dev=true:1200:15)",
      "    at onPress (http://10.0.2.2:8081/index.bundle?platform=android&dev=true:1300:7)",
      "    at apply (native)",
      "    at _performTransitionSideEffects (http://10.0.2.2:8081/node_modules/react-native/Libraries/Pressability/Pressability.js:1:2)",
    ].join("\n");
    assert.deepEqual(monitor.parseStack(stack), [
      { file: "http://10.0.2.2:8081/node_modules/react-native/Libraries/Pressability/Pressability.js", function: "_performTransitionSideEffects", line: 1, col: 2, inApp: false },
      { file: "native", function: "apply", inApp: false },
      { file: "http://10.0.2.2:8081/index.bundle", function: "onPress", line: 1300, col: 7, inApp: true },
      { file: "http://10.0.2.2:8081/index.bundle", function: "calcTotal", line: 1200, col: 15, inApp: true },
    ]);
  });

  it("Hermes em produção (address at) e JSC", () => {
    const hermes = "Error: x\n    at calc (address at index.android.bundle:1:23456)\n    at anonymous (InternalBytecode.js:1:900)";
    assert.deepEqual(monitor.parseStack(hermes), [
      { file: "InternalBytecode.js", line: 1, col: 900, inApp: false },
      { file: "index.android.bundle", function: "calc", line: 1, col: 23456, inApp: true },
    ]);
    const jsc = "calc@http://localhost:8081/index.bundle?platform=ios:50:3\nforEach@[native code]\nglobal code@http://localhost:8081/index.bundle?platform=ios:1:1";
    assert.deepEqual(monitor.parseStack(jsc), [
      { file: "http://localhost:8081/index.bundle", line: 1, col: 1, inApp: true },
      { file: "[native code]", function: "forEach", inApp: false },
      { file: "http://localhost:8081/index.bundle", function: "calc", line: 50, col: 3, inApp: true },
    ]);
  });
});
