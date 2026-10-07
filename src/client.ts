/**
 * O monitor do app (singleton) e os ganchos globais do React Native.
 *
 * - `ErrorUtils.setGlobalHandler`: encadeia o handler anterior (a tela vermelha em dev, o crash em
 *   produção continuam iguais). Erro fatal: level `fatal`, flush com teto de 2 s e só então o
 *   handler anterior.
 * - Rejeição de promessa não tratada: pelo rastreador do Hermes quando existe; senão pelo
 *   `promise/setimmediate/rejection-tracking` (try/catch — se não der, segue sem).
 * - Envio por `fetch` com o motor `engine.ts` (o mesmo do pacote Node).
 * - Sinal de vida (§7b): 1 por `init`. Sem armazenamento no aparelho (seria dependência), o
 *   `instance` é aleatório por execução do app.
 */
import {
  Engine,
  newScope,
  pushBreadcrumb,
  setScopeTag,
  toException,
  type Level,
  type MonitorEvent,
  type Scope,
} from './engine.js'
import { parseStack } from './stack.js'
import { SDK_NAME, VERSION } from './version.js'

declare const require: undefined | ((id: string) => any)
declare const __DEV__: boolean | undefined

export interface InitOptions {
  /** Chave do agente (`bf_mon_…`). Obrigatória. */
  key: string
  /** Versão do seu app (`1.4.2`). */
  release?: string
  /** Padrão `production`. */
  environment?: string
  /** Padrão `https://api.bfocus.com.br`. */
  baseUrl?: string
  /** 0..1 — fração dos erros enviada (padrão 1). */
  sampleRate?: number
  /** Mensagens a ignorar (texto contido ou RegExp). */
  ignore?: (string | RegExp)[]
  /** Última chance de mudar ou descartar (devolva null) o evento. */
  beforeSend?: (event: MonitorEvent) => MonitorEvent | null | undefined
  /** Instalar os ganchos globais (padrão true). */
  autoCapture?: boolean
}

export interface CaptureOptions {
  level?: Level
  tags?: Record<string, string>
  fingerprint?: string[]
}

export interface MonitorIdentity {
  user?: { externalId: string; userHash?: string }
  customer?: { externalId: string }
}

let engine: Engine | null = null
let scope: Scope = newScope()
let instance = ''

function randomId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
    if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '')
  } catch { /* ignore */ }
  let id = ''
  for (let i = 0; i < 32; i += 1) id += Math.floor(Math.random() * 16).toString(16)
  return id
}

function detectContexts(): Record<string, Record<string, string>> {
  const g = globalThis as { HermesInternal?: unknown }
  const contexts: Record<string, Record<string, string>> = { runtime: { name: g.HermesInternal ? 'hermes' : 'jsc' } }
  try {
    if (typeof require === 'function') {
      const { Platform } = require('react-native')
      if (Platform && Platform.OS) contexts.os = { name: String(Platform.OS), version: String(Platform.Version ?? '') }
    }
  } catch { /* fora do React Native (testes) */ }
  return contexts
}

export function init(opts: InitOptions): void {
  if (!opts || typeof opts.key !== 'string' || !opts.key.trim()) {
    throw new TypeError('bFocus monitor: `key` é obrigatória (a chave do agente, bf_mon_…)')
  }
  const previous = engine
  if (previous) {
    previous.drain()
    previous.closed = true
  }
  scope = newScope()
  const contexts = detectContexts()
  engine = new Engine({
    key: opts.key.trim(),
    release: opts.release,
    environment: opts.environment,
    baseUrl: opts.baseUrl,
    sampleRate: opts.sampleRate,
    ignore: opts.ignore,
    beforeSend: opts.beforeSend,
    sdk: { name: SDK_NAME, version: VERSION },
    contexts,
  })
  if (opts.autoCapture === false) removeHooks()
  else installHooks()
  try {
    if (!instance) instance = randomId()
    void engine.heartbeat({ instance, runtime: contexts.runtime })
  } catch { /* nunca derruba o app */ }
}

function capture(err: unknown, level: Level, extra: CaptureOptions = {}, nonErrorType = 'Error'): void {
  try {
    if (!engine) return
    engine.capture(toException(err, parseStack, nonErrorType), level, [scope], { tags: extra.tags, fingerprint: extra.fingerprint })
  } catch { /* nunca derruba o app */ }
}

export function captureException(err: unknown, opts: CaptureOptions = {}): void {
  capture(err, opts.level ?? 'error', opts)
}

export function captureMessage(message: string, level: Level = 'info'): void {
  try {
    engine?.capture({ type: 'Message', message: String(message), frames: [] }, level, [scope], { fingerprint: [String(message)] })
  } catch { /* ignore */ }
}

/**
 * Quem foi afetado. O `userHash` vem do SEU servidor (a mesma assinatura v2 do widget) — o
 * segredo nunca vai para o app. Sem argumentos, limpa.
 */
export function setUser(user?: MonitorIdentity['user'] | null, customer?: MonitorIdentity['customer'] | null): void {
  try {
    if (user && user.externalId) {
      scope.user = user.userHash ? { externalId: String(user.externalId), userHash: String(user.userHash) } : { externalId: String(user.externalId) }
    } else {
      delete scope.user
    }
    if (customer && customer.externalId) scope.customer = { externalId: String(customer.externalId) }
    else delete scope.customer
  } catch { /* ignore */ }
}

export function setTag(key: string, value: string): void {
  try { setScopeTag(scope, key, value) } catch { /* ignore */ }
}

export function addBreadcrumb(category: string, message: string, level: Level = 'info'): void {
  try { pushBreadcrumb(scope, category, message, level) } catch { /* ignore */ }
}

/** Espera o envio do que está na fila, com teto (ms). `true` = tudo saiu a tempo. */
export function flush(timeoutMs = 2000): Promise<boolean> {
  return engine ? engine.flush(timeoutMs) : Promise.resolve(true)
}

/** Esvazia a fila, desliga o envio e devolve os handlers anteriores. */
export async function close(timeoutMs = 2000): Promise<boolean> {
  removeHooks()
  const e = engine
  engine = null
  return e ? e.close(timeoutMs) : true
}

// ── ganchos globais ──────────────────────────────────────────────────────────

type GlobalHandler = (error: unknown, isFatal?: boolean) => void
interface ErrorUtilsLike {
  getGlobalHandler?: () => GlobalHandler | undefined
  setGlobalHandler: (handler: GlobalHandler) => void
}

let hooks: { errorUtils?: ErrorUtilsLike; previous?: GlobalHandler; handler?: GlobalHandler } | null = null
/** O rastreador de rejeições não tem "desligar": liga uma vez e obedece a `hooks`. */
let rejectionTracking = false

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && !!__DEV__
}

function onUnhandledRejection(id: number, rejection: unknown): void {
  if (hooks) capture(rejection, 'error', {}, 'UnhandledRejection')
  if (isDev()) {
    // O que o React Native faz sozinho em dev (o rastreador dele foi trocado pelo nosso).
    try {
      const text = rejection instanceof Error ? rejection.stack || rejection.message : String(rejection)
      console.warn(`Possible unhandled promise rejection (id: ${id}):\n${text}`)
    } catch { /* ignore */ }
  }
}

function enableRejectionTracking(): void {
  if (rejectionTracking) return
  const options = { allRejections: true, onUnhandled: onUnhandledRejection, onHandled: () => {} }
  try {
    const hermes = (globalThis as { HermesInternal?: { hasPromise?: () => boolean; enablePromiseRejectionTracker?: (o: unknown) => void } }).HermesInternal
    if (hermes && typeof hermes.enablePromiseRejectionTracker === 'function' && (typeof hermes.hasPromise !== 'function' || hermes.hasPromise())) {
      hermes.enablePromiseRejectionTracker(options)
      rejectionTracking = true
      return
    }
  } catch { /* segue para o polyfill */ }
  try {
    // Chamada indireta de propósito: o Metro não tenta resolver o módulo na hora de empacotar
    // (um `require('promise/...')` literal quebraria o build de quem não tem o pacote `promise`
    // alcançável); se não estiver disponível em tempo de execução, cai no catch.
    const load = typeof require === 'function' ? require : undefined
    const tracking = load ? load('promise/setimmediate/rejection-tracking') : undefined
    if (tracking && typeof tracking.enable === 'function') {
      tracking.enable(options)
      rejectionTracking = true
    }
  } catch { /* sem rastreador: segue sem capturar rejeições */ }
}

function installHooks(): void {
  if (hooks) return
  hooks = {}
  try {
    const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils
    if (errorUtils && typeof errorUtils.setGlobalHandler === 'function') {
      const previous = typeof errorUtils.getGlobalHandler === 'function' ? errorUtils.getGlobalHandler() : undefined
      const handler: GlobalHandler = (error, isFatal) => {
        capture(error, isFatal ? 'fatal' : 'error')
        if (typeof previous !== 'function') return
        if (!isFatal) {
          previous(error, isFatal)
          return
        }
        let called = false
        const next = () => {
          if (called) return
          called = true
          previous(error, isFatal)
        }
        flush(2000).then(next, next)
      }
      errorUtils.setGlobalHandler(handler)
      hooks = { errorUtils, previous, handler }
    }
  } catch { /* ignore */ }
  enableRejectionTracking()
}

function removeHooks(): void {
  if (!hooks) return
  try {
    const { errorUtils, previous, handler } = hooks
    if (errorUtils && handler && previous && (typeof errorUtils.getGlobalHandler !== 'function' || errorUtils.getGlobalHandler() === handler)) {
      errorUtils.setGlobalHandler(previous)
    }
  } catch { /* ignore */ }
  hooks = null
}
