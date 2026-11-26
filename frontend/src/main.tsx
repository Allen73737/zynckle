import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { installErrorReporting, reportError } from './lib/errorReporting';
import './styles.css';

installErrorReporting();

/** Last line of defence: a crash in any page shows a way out instead of a blank screen, and is reported. */
class CrashBoundary extends React.Component<{ children: React.ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(error: unknown, info: React.ErrorInfo) { reportError(error, (info.componentStack || '').split('\n').find(l => l.trim())?.trim() || 'react'); }
  render() {
    if (!this.state.crashed) return this.props.children;
    return <div className="empty-state" role="alert" style={{ margin: '15vh auto', maxWidth: 460, padding: 16 }}>
      <h1>Something went wrong</h1>
      <p>This page hit an unexpected error. It has been reported. Your work is saved on the server.</p>
      <button className="button-primary" onClick={() => location.reload()}>Reload Zynckle</button>
    </div>;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><CrashBoundary><BrowserRouter><App /></BrowserRouter></CrashBoundary></React.StrictMode>);
