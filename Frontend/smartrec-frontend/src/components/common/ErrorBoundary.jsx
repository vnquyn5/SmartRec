import React from 'react';
import {
  buildErrorBoundaryViewModel,
  hasResetKeysChanged,
} from '../../utils/errorBoundaryUtils';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
    this.handleReset = this.handleReset.bind(this);
    this.handleReloadPage = this.handleReloadPage.bind(this);
    this.handleNavigateHome = this.handleNavigateHome.bind(this);
    this.handleSimulatedError = this.handleSimulatedError.bind(this);
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error: error || new Error('Unknown render error'),
    };
  }

  componentDidMount() {
    if (typeof window !== 'undefined') {
      window.addEventListener('smartrec:simulate-error', this.handleSimulatedError);
    }
  }

  componentWillUnmount() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('smartrec:simulate-error', this.handleSimulatedError);
    }
  }

  handleSimulatedError(event) {
    const targetLevel = event?.detail?.level || 'page';
    const currentLevel = this.props.level || 'page';
    if (targetLevel !== currentLevel) return;

    const simulatedMessage =
      event?.detail?.message ||
      'Simulated workspace render exception (Test Error Boundary)';
    const simulatedError = new Error(simulatedMessage);
    if (event?.detail?.name) {
      simulatedError.name = event.detail.name;
    }
    this.setState({
      hasError: true,
      error: simulatedError,
    });
  }

  componentDidCatch(error, errorInfo) {
    if (typeof this.props.onError === 'function') {
      this.props.onError(error, errorInfo);
    }
  }

  componentDidUpdate(prevProps) {
    if (!this.state.hasError) return;
    if (hasResetKeysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReset() {
    this.setState({ hasError: false, error: null });
    if (typeof this.props.onReset === 'function') {
      this.props.onReset();
    }
  }

  handleReloadPage() {
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  }

  handleNavigateHome() {
    this.setState({ hasError: false, error: null });
    if (typeof this.props.onNavigateHome === 'function') {
      this.props.onNavigateHome();
      return;
    }
    if (typeof window !== 'undefined' && window.location) {
      window.location.assign('/history');
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (typeof this.props.fallback === 'function') {
      return this.props.fallback({
        error: this.state.error,
        resetErrorBoundary: this.handleReset,
      });
    }

    const level = this.props.level || 'page';
    const viewModel = buildErrorBoundaryViewModel(this.state.error, {
      level,
      isProduction: true,
    });

    const containerClass =
      level === 'app'
        ? 'min-h-screen w-full bg-[#070b19] text-slate-100 flex items-center justify-center p-6'
        : 'min-h-[380px] w-full rounded-2xl border border-[#1b2640] bg-[#0c1324] text-slate-100 flex items-center justify-center p-6 my-2';

    return (
      <div role="alert" data-testid="error-boundary-fallback" className={containerClass}>
        <div className="max-w-lg w-full rounded-2xl border border-rose-500/35 bg-[#090f1d] p-6 shadow-2xl flex flex-col gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 flex items-center justify-center shrink-0 font-bold text-base">
              !
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-white">{viewModel.title}</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-rose-950/60 text-rose-300 border border-rose-500/40">
                  {viewModel.kind}
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{viewModel.message}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-[#162038]">
            <button
              type="button"
              onClick={this.handleNavigateHome}
              className="px-3.5 py-2 rounded-xl border border-[#223254] bg-[#0c1324] hover:bg-[#13203d] text-xs font-semibold text-slate-200 transition"
            >
              {viewModel.secondaryActionLabel}
            </button>

            {viewModel.isChunkError ? (
              <button
                type="button"
                onClick={this.handleReloadPage}
                className="px-4 py-2 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-xs font-semibold text-white transition shadow-sm"
              >
                {viewModel.primaryActionLabel}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={this.handleReloadPage}
                  className="px-3.5 py-2 rounded-xl border border-[#223254] bg-[#0c1324] hover:bg-[#13203d] text-xs font-semibold text-slate-300 hover:text-white transition"
                >
                  Tải lại trang
                </button>
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="px-4 py-2 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-xs font-semibold text-white transition shadow-sm"
                >
                  {viewModel.primaryActionLabel}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
}

