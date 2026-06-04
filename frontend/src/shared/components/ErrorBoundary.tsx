import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t as i18nT } from '@/i18n';

interface Props {
  children: ReactNode;
  label?: string;
  resetKey?: unknown;
}

interface State {
  error: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary:', error, info);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error !== null && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <strong>{this.props.label ?? i18nT('errors.generic')}</strong>
          <p className="ui-text-sm error-boundary-message">{this.state.error}</p>
          <button
            type="button"
            className="btn btn-sm error-boundary-retry"
            onClick={() => this.setState({ error: null })}
          >
            {i18nT('common.tryAgain')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
