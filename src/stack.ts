/**
 * Rastro do Hermes e do JavaScriptCore (de dentro para fora) → frames do contrato (de fora para
 * dentro).
 *
 * Hermes: "    at fn (address at index.android.bundle:1:2345)", "    at fn (http://host:8081/index.bundle?platform=ios:12:3)",
 *         "    at fn (native)"
 * JSC:    "fn@http://host:8081/index.bundle?platform=ios:12:3", "forEach@[native code]"
 */
import type { Frame } from './engine.js'

const AT_RE = /^\s*at (?:(.+?) \()?(?:address at )?(.+?):(\d+):(\d+)\)?\s*$/
const AT_NATIVE_RE = /^\s*at (.+?) \((native)\)\s*$/
const JSC_RE = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/
const JSC_NATIVE_RE = /^\s*(.*?)@(\[native code\])\s*$/

function isLibrary(file: string): boolean {
  return (
    file === 'native' ||
    file === '[native code]' ||
    /(^|[\\/])node_modules[\\/]/.test(file) ||
    /InternalBytecode\.js$/.test(file) ||
    /@bfocus[\\/]monitor-react-native[\\/]/.test(file)
  )
}

export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return []
  const frames: Frame[] = []
  for (const raw of stack.split('\n').slice(0, 100)) {
    let m = AT_NATIVE_RE.exec(raw) || JSC_NATIVE_RE.exec(raw)
    let line: number | undefined
    let col: number | undefined
    if (!m) {
      m = AT_RE.exec(raw) || JSC_RE.exec(raw)
      if (!m) continue
      line = Number(m[3])
      col = Number(m[4])
    }
    const file = String(m[2] || '').split('?')[0]!.split('#')[0]!
    if (!file) continue
    const fn = (m[1] || '').replace(/^(async |new )/, '').trim()
    const frame: Frame = { file }
    if (fn && fn !== 'anonymous' && fn !== 'global code') frame.function = fn
    if (line !== undefined && Number.isFinite(line)) frame.line = line
    if (col !== undefined && Number.isFinite(col)) frame.col = col
    frame.inApp = !isLibrary(file)
    frames.push(frame)
  }
  return frames.reverse()
}
