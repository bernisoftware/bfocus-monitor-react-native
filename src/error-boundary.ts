/**
 * ErrorBoundary que manda o erro da renderização ao bFocus.
 *
 *   import { ErrorBoundary } from '@bfocus/monitor-react-native'
 *   <ErrorBoundary fallback={<Text>Algo deu errado</Text>}><App /></ErrorBoundary>
 *
 * `react` é peerDependency (todo app React Native já tem).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { captureException } from './client.js'

export interface ErrorBoundaryProps {
  children?: ReactNode
  /** O que mostrar no lugar da árvore quebrada (ou uma função que recebe o erro e o `resetError`). */
  fallback?: ReactNode | ((props: { error: unknown; resetError: () => void }) => ReactNode)
  /** Tags a mais no evento. */
  tags?: Record<string, string>
  /** Chamado depois da captura. */
  onError?: (error: unknown, info: ErrorInfo) => void
}

interface State { hasError: boolean; error: unknown }

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    captureException(error, this.props.tags ? { tags: this.props.tags } : undefined)
    try { this.props.onError?.(error, info) } catch { /* ignore */ }
  }

  resetError = (): void => {
    this.setState({ hasError: false, error: null })
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children ?? null
    const { fallback } = this.props
    if (typeof fallback === 'function') return fallback({ error: this.state.error, resetError: this.resetError })
    return fallback ?? null
  }
}
