import { useEffect, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, Moon, Sparkles, Sun } from 'lucide-react';
import { api, errorMessage } from './lib/api';

type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';

const strength = (password: string) => {
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return score;
};

/** Sign-up, sign-in, recovery and verification. Layout matches the original auth screen. */
export default function AuthGate({ onSuccess, theme, onTheme }: { onSuccess: (token: string) => void; theme: string; onTheme: () => void }) {
  const params = new URLSearchParams(location.search);
  const initial: Mode = location.pathname.startsWith('/reset-password') ? 'reset' : location.pathname.startsWith('/verify-email') ? 'verify' : location.pathname.startsWith('/signin') ? 'login' : localStorage.getItem('zynckle-has-account') ? 'login' : 'register';
  const [mode, setMode] = useState<Mode>(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState(params.get('error') || '');
  const [info, setInfo] = useState('');
  const [devLink, setDevLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);
  const token = params.get('token') || '';

  useEffect(() => {
    api<{ google: boolean }>('/api/auth/providers').then(p => setGoogle(p.google)).catch(() => {});
    const hash = new URLSearchParams(location.hash.slice(1)).get('token');
    if (hash) { history.replaceState({}, '', '/'); onSuccess(hash); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== 'verify' || !token) return;
    setBusy(true);
    api<{ email: string }>('/api/auth/verify', { body: { token } }).then(r => setInfo(`${r.email} is verified. You can sign in now.`)).catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
  }, [mode, token]);

  const switchMode = (next: Mode) => { setMode(next); setError(''); setInfo(''); setDevLink(''); if (location.pathname !== '/') history.replaceState({}, '', '/'); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'register' || mode === 'login') {
        const data = await api<{ token: string }>(`/api/auth/${mode}`, { body: { name, email, password } });
        localStorage.setItem('zynckle-has-account', 'yes');
        onSuccess(data.token);
      } else if (mode === 'forgot') {
        const data = await api<{ resetUrl?: string; emailDelivery: boolean; devMode: boolean }>('/api/auth/forgot', { body: { email } });
        setInfo(data.emailDelivery ? 'If an account exists for that address, a reset link is on its way.' : 'If an account exists for that address, a reset link was created. Email delivery is not configured on this server, so the link is written to the API log.');
        if (data.resetUrl) setDevLink(data.resetUrl);
      } else if (mode === 'reset') {
        const data = await api<{ token: string }>('/api/auth/reset', { body: { token, password } });
        history.replaceState({}, '', '/');
        onSuccess(data.token);
      }
    } catch (ex) { setError(errorMessage(ex, 'Workspace API unavailable. Start the backend or enter instant mode below.')); }
    finally { setBusy(false); }
  };

  const enterDemo = () => {
    localStorage.setItem('zynckle-token', 'zynckle-demo-token');
    localStorage.setItem('zynckle-has-account', 'yes');
    onSuccess('zynckle-demo-token');
  };

  const googleSignIn = async () => { try { const r = await api<{ redirect: string }>('/api/auth/google/start'); location.assign(r.redirect); } catch (e) { setError(errorMessage(e)); } };
  const score = strength(password);
  const heading = { register: <>Make room for <em>good work.</em></>, login: <>Welcome <em>back.</em></>, forgot: <>Reset your <em>password.</em></>, reset: <>Choose a new <em>password.</em></>, verify: <>Verifying your <em>email.</em></> }[mode];
  const sub = { register: 'A calmer place to plan, write, build and bring people together.', login: 'Pick up exactly where you left off.', forgot: 'Enter the email you use for Zynckle and we will create a reset link.', reset: 'Use at least 10 characters with a number or symbol. Other sessions will be signed out.', verify: 'One moment while we confirm your address.' }[mode];

  return <div className="auth-screen"><button className="icon-button auth-theme" onClick={onTheme} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button>
    <section className="auth-panel"><a className="brand" href="/"><span className="brand-mark">z</span><span>zynckle</span></a><div className="eyebrow">ONE WORKSPACE. EVERYTHING CONNECTED.</div><h1>{heading}</h1><p className="welcome-sub">{sub}</p>
      {mode === 'verify' ? <div className="auth-form">{busy && <p className="welcome-sub">Checking your link…</p>}{info && <p className="zy-auth-info" role="status">{info}</p>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="button-primary auth-submit" onClick={() => switchMode('login')}>Continue to sign in</button></div>
        : <form onSubmit={submit} className="auth-form">
          {mode === 'register' && <label>Your name<input required autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Alex Morgan" maxLength={100}/></label>}
          {mode !== 'reset' && <label>Email address<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/></label>}
          {mode !== 'forgot' && <label><span className="zy-label-row">Password{mode === 'login' && <button type="button" className="zy-link-button" onClick={() => switchMode('forgot')}>Forgot password?</button>}</span>
            <span className="zy-password"><input required type={show ? 'text' : 'password'} minLength={mode === 'login' ? 1 : 10} maxLength={200} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'login' ? 'Your password' : 'At least 10 characters'}/><button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={15}/> : <Eye size={15}/>}</button></span>
            {mode !== 'login' && password && <span className="zy-strength" aria-live="polite"><i className={`s${score}`}/><small>{['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score]}</small></span>}</label>}
          {error && <div className="auth-error" role="alert"><p>{error}</p><button type="button" className="button-secondary auth-submit zy-demo-btn" onClick={enterDemo}><Sparkles size={14}/> Enter Instant Workspace Mode</button></div>}
          {info && <p className="zy-auth-info" role="status">{info}</p>}
          {devLink && <a className="zy-dev-link" href={devLink}>Development link: open the reset page →</a>}
          <button className="button-primary auth-submit" disabled={busy || (mode === 'reset' && !token)}>{busy ? 'Please wait…' : { register: 'Create your workspace', login: 'Sign in', forgot: 'Create reset link', reset: 'Set new password', verify: '' }[mode]}</button>
          <div className="zy-or"><span>or</span></div>
          <button type="button" className="button-secondary auth-submit zy-instant-btn" onClick={enterDemo}><Sparkles size={14}/> Instant Demo Workspace (No sign-in required)</button>
          {mode === 'reset' && !token && <p className="auth-error">This reset link is incomplete. Request a new one.</p>}
          {google && (mode === 'login' || mode === 'register') && <button type="button" className="button-secondary auth-submit" onClick={googleSignIn}><svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3zM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22zm-5.6-8a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9zM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z"/></svg> Continue with Google</button>}
        </form>}
      {mode === 'register' || mode === 'login' ? <button className="auth-switch" onClick={() => switchMode(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? 'Already have an account? Sign in' : 'New to Zynckle? Create an account'}</button>
        : mode !== 'verify' && <button className="auth-switch" onClick={() => switchMode('login')}><ArrowLeft size={12}/> Back to sign in</button>}
      <p className="auth-foot">Passwords are hashed with scrypt; sessions can be revoked from Settings. Keep the API behind HTTPS before allowing remote access.</p></section>
    <aside className="auth-aside"><div className="auth-aside-art"><span>z</span><i/><b/></div><p>Plan with clarity.<br/>Make with intention.</p><span>YOUR WORK, IN GOOD COMPANY.</span></aside></div>;
}
