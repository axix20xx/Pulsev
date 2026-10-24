import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
  useState,
} from 'react';

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
  componentStack?: string | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function DefaultFallback({
  error,
  resetError,
  componentStack,
}: ErrorFallbackProps) {
  const [copyStatus, setCopyStatus] = useState('');
  const diagnostic = [
    `Message: ${error.message || String(error)}`,
    `Path: ${window.location.pathname}`,
    `Browser: ${navigator.userAgent}`,
    `Component stack:${componentStack || '\n(not available)'}`,
  ].join('\n\n');

  const copyDiagnostic = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(diagnostic);
      } else {
        const field = document.createElement('textarea');
        field.value = diagnostic;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        if (!copied) throw new Error('Clipboard copy is unavailable');
      }
      setCopyStatus('جزئیات فنی کپی شد.');
    } catch {
      setCopyStatus('کپی خودکار انجام نشد؛ متن زیر را دستی کپی کنید.');
    }
  };

  return (
    <main className="admin-console console-error-state" dir="rtl">
      <section className="console-error-card">
        <span className="console-error-code">PULSE / UI ERROR</span>
        <h1>بخشی از فضای کاری با خطا روبه‌رو شد</h1>
        <p>
          رابط کاربری مرورگر هنگام نمایش این صفحه با خطا روبه‌رو شد. برای دیدن
          علت دقیق، جزئیات فنی را باز کنید.
        </p>
        <details className="console-error-diagnostics">
          <summary>جزئیات فنی</summary>
          <p className="console-error-warning">
            پیش از ارسال، متن را بررسی کنید و هر اطلاعات حساسی را حذف کنید.
          </p>
          <pre className="console-error-detail" dir="ltr">{diagnostic}</pre>
          <button
            type="button"
            onClick={() => void copyDiagnostic()}
            className="console-action console-action-secondary"
            data-testid="button-copy-error-diagnostics"
          >
            کپی جزئیات فنی
          </button>
          {copyStatus ? <p role="status">{copyStatus}</p> : null}
        </details>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="console-action console-action-primary"
          data-testid="button-reload-after-ui-error"
        >
          بارگذاری دوبارهٔ برنامه
        </button>
        <button
          type="button"
          onClick={resetError}
          className="console-action console-action-secondary"
          data-testid="button-retry-after-ui-error"
        >
          تلاش دوباره بدون بارگذاری
        </button>
      </section>
    </main>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error), componentStack: null };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      'ErrorBoundary caught an error:',
      toError(error),
      info.componentStack,
    );
    this.setState({
      error: toError(error),
      componentStack: info.componentStack ?? null,
    });
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return (
      <Fallback
        error={error}
        resetError={this.resetError}
        componentStack={componentStack}
      />
    );
  }
}
