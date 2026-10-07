/**
 * Ganchos do React Native com o ambiente simulado (ErrorUtils e HermesInternal falsos): o erro
 * chega ao bFocus E o handler anterior continua rodando.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import * as monitor from "@bfocus/monitor-react-native";
import { sleep, startServer, type TestServer } from "./helpers/server.js";

const g = globalThis as any;
let server: TestServer;
let calls: [unknown, boolean | undefined][];
let current: ((e: unknown, f?: boolean) => void) | undefined;
let tracker: any;
const previous = (e: unknown, f?: boolean) => {
  calls.push([e, f]);
};

before(async () => {
  server = await startServer();
  g.HermesInternal = { hasPromise: () => true, enablePromiseRejectionTracker: (o: any) => (tracker = o) };
});
after(async () => {
  delete g.HermesInternal;
  delete g.ErrorUtils;
  await server.close();
});
afterEach(async () => {
  await monitor.close(100);
  server.requests.length = 0;
});

function fakeErrorUtils() {
  calls = [];
  current = previous;
  g.ErrorUtils = {
    getGlobalHandler: () => current,
    setGlobalHandler: (h: any) => (current = h),
  };
}

const events = () => server.requests.flatMap((r) => r.body.events);

describe("ErrorUtils", () => {
  it("encadeia: erro não fatal vai ao handler anterior na hora", async () => {
    fakeErrorUtils();
    monitor.init({ key: "k", baseUrl: server.url, release: "3.1.0" });
    assert.notEqual(current, previous, "instalou o nosso");
    const err = new TypeError("não fatal");
    current!(err, false);
    assert.deepEqual(calls, [[err, false]]);
    await monitor.flush(1000);
    const [ev] = events();
    assert.equal(ev.level, "error");
    assert.equal(ev.exception.type, "TypeError");
    assert.equal(ev.release, "3.1.0");
    assert.equal(ev.contexts.runtime.name, "hermes");
    assert.equal(server.requests[0]!.headers["x-bfocus-client"], `bfocus-monitor-react-native/${monitor.VERSION}`);
  });

  it("fatal: level fatal, envia ANTES de chamar o handler anterior", async () => {
    fakeErrorUtils();
    monitor.init({ key: "k", baseUrl: server.url });
    const err = new Error("fatal");
    current!(err, true);
    assert.equal(calls.length, 0, "espera o envio");
    await server.waitFor(1, 3000);
    await sleep(20);
    assert.deepEqual(calls, [[err, true]]);
    assert.equal(events()[0].level, "fatal");
  });

  it("close devolve o handler anterior", async () => {
    fakeErrorUtils();
    monitor.init({ key: "k", baseUrl: server.url });
    assert.notEqual(current, previous);
    await monitor.close();
    assert.equal(current, previous);
  });

  it("autoCapture false não mexe no ErrorUtils", () => {
    fakeErrorUtils();
    monitor.init({ key: "k", baseUrl: server.url, autoCapture: false });
    assert.equal(current, previous);
  });
});

describe("rejeição de promessa", () => {
  it("pelo rastreador do Hermes; não Error vira UnhandledRejection", async () => {
    fakeErrorUtils();
    monitor.init({ key: "k", baseUrl: server.url });
    assert.equal(typeof tracker?.onUnhandled, "function");
    assert.equal(tracker.allRejections, true);
    tracker.onUnhandled(1, new RangeError("rejeitada"));
    tracker.onUnhandled(2, "só texto");
    await monitor.flush(1000);
    assert.deepEqual(events().map((e) => [e.level, e.exception.type, e.exception.message]), [
      ["error", "RangeError", "rejeitada"],
      ["error", "UnhandledRejection", "só texto"],
    ]);
  });

  it("depois do close, o rastreador não manda nada", async () => {
    await monitor.close();
    tracker.onUnhandled(3, new Error("depois"));
    await sleep(50);
    assert.equal(server.requests.length, 0);
  });
});
