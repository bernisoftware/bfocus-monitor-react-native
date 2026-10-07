/**
 * @bfocus/monitor-react-native — erros do seu app viram demanda no bFocus.
 *
 *   import * as monitor from '@bfocus/monitor-react-native'
 *   monitor.init({ key: 'bf_mon_…', release: '1.4.2' })
 *   monitor.setUser({ externalId: 'u-123', userHash }, { externalId: 'cliente-9' })
 *   <monitor.ErrorBoundary fallback={<Text>Algo deu errado</Text>}><App /></monitor.ErrorBoundary>
 */
export { init, captureException, captureMessage, setUser, setTag, addBreadcrumb, flush, close } from './client.js'
export type { InitOptions, CaptureOptions, MonitorIdentity } from './client.js'
export { ErrorBoundary } from './error-boundary.js'
export type { ErrorBoundaryProps } from './error-boundary.js'
export { parseStack } from './stack.js'
export { VERSION, SDK_NAME } from './version.js'
export type { Level, Frame, MonitorEvent, Breadcrumb } from './engine.js'
