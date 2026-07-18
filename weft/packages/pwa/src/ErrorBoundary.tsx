// React error boundary — catches thrown errors anywhere in the child tree
// and shows a plain, honest failure card rather than a blank page or a
// stack trace.
//
// OBSERVABILITY.md forbids automatic crash reporting, so this boundary
// logs to console only. Users who want to send us a bug can copy the
// error text manually.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { tokens } from './styles';

interface Props {
  readonly children: ReactNode;
}
interface State {
  readonly error: Error | null;
  readonly info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console-only: users under threat model A6 (supply-chain) or A2 (active
    // relay) could otherwise be surveilled via crash telemetry. See
    // OBSERVABILITY.md § Anti-patterns.
    console.error('Weft caught an error:', error, info);
    this.setState({ error, info });
  }

  private reset = (): void => {
    this.setState({ error: null, info: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <ErrorFallback error={this.state.error} info={this.state.info} onDismiss={this.reset} />;
  }
}

function ErrorFallback({
  error,
  info,
  onDismiss,
}: {
  error: Error;
  info: ErrorInfo | null;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        fontFamily: tokens.sans,
        background: tokens.paper,
        minHeight: '100vh',
        color: tokens.ink,
      }}
    >
      <div style={{ maxWidth: 400, margin: '0 auto', padding: '18px 20px 90px' }}>
        <div
          style={{
            background: tokens.dangerSoft,
            border: `1.5px solid ${tokens.danger}`,
            borderRadius: tokens.cardRadius,
            padding: 15,
            marginBottom: 15,
          }}
        >
          <h2 style={{ fontFamily: tokens.serif, fontSize: 19, margin: '0 0 8px' }}>
            Something went wrong.
          </h2>
          <p>
            Weft hit an unexpected error and stopped drawing this part of the app. Your data on
            this device wasn't touched.
          </p>
          <p style={{ color: tokens.muted, fontSize: 13 }}>Here's what we know:</p>
          <pre
            style={{
              fontSize: 12,
              background: tokens.card,
              padding: 12,
              borderRadius: tokens.buttonRadius,
              border: `1px solid ${tokens.line}`,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'auto',
              maxHeight: 200,
              fontFamily: 'monospace',
            }}
          >
            {error.name}: {error.message}
            {info?.componentStack ? `\n\nComponent stack:${info.componentStack}` : ''}
          </pre>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                flex: 1,
                minWidth: 120,
                padding: 14,
                background: tokens.accent,
                color: 'white',
                border: 'none',
                borderRadius: tokens.buttonRadius,
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Reload
            </button>
            <button
              onClick={onDismiss}
              style={{
                flex: 1,
                minWidth: 120,
                padding: 14,
                background: tokens.accentSoft,
                color: tokens.accent,
                border: 'none',
                borderRadius: tokens.buttonRadius,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Try to continue
            </button>
          </div>
          <p style={{ fontSize: 12, color: tokens.muted, marginTop: 12 }}>
            Still broken after reload? Go to <a href="#why" style={{ color: tokens.accent }}>Why
            it works this way</a> → <em>Start over</em> to wipe local state. Your friends' devices
            keep their copies of vouches you sent them.
          </p>
        </div>
      </div>
    </div>
  );
}
