import { useEffect, useState } from 'react';
import { Alert, Button, TextField } from '@mui/material';
import { ArrowRight, Leaf, MailCheck } from 'lucide-react';
import { errorText, post } from './api';
import type { Role, User } from './types';

interface Challenge { challenge: string; expiresInSeconds: number; resendAfterSeconds: number; message: string }
export function AuthPage({ onLogin, demo, signupAvailable }: { onLogin: (user: User) => void; demo: boolean; signupAvailable: boolean }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'verify'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [name, setName] = useState(''); const [department, setDepartment] = useState('');
  const [confirmation, setConfirmation] = useState(''); const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [deadline, setDeadline] = useState(0); const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [deadline]);
  function switchMode(next: 'login' | 'signup') { setMode(next); setError(''); setMessage(''); setPassword(''); setConfirmation(''); setCode(''); setChallenge(null); }
  function received(result: Challenge) { setChallenge(result); setDeadline(Date.now() + result.resendAfterSeconds * 1000); setMessage(result.message); setCode(''); }
  async function submit(role?: Role) {
    setError(''); setBusy(true);
    try {
      if (role) onLogin(await post<User>('/auth/demo', { role }));
      else if (mode === 'login') onLogin(await post<User>('/auth/login', { email: email.trim().toLowerCase(), password }));
      else if (mode === 'signup') {
        if (password !== confirmation) throw new Error('Passwords do not match.');
        received(await post<Challenge>('/auth/signup', { email, password, name, department }));
        setPassword(''); setConfirmation(''); setMode('verify');
      } else if (challenge) onLogin(await post<User>('/auth/signup/verify', { challenge: challenge.challenge, code }));
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function resend() {
    if (!challenge) return;
    setError(''); setBusy(true);
    try { received(await post<Challenge>('/auth/signup/resend', { challenge: challenge.challenge })); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="login-page">
    <section className="login-story">
      <div className="brand"><span className="brand-mark"><Leaf size={24} /></span>nemo<span className="brand-dot">.</span></div>
      <div><span className="login-kicker">YOUR WORK. YOUR EXPENSES. IN ORDER.</span><h1>Less paperwork.<br />More peace of mind.</h1><p>From the first receipt to the final reimbursement.<br />A clear path for every business expense.</p><div className="login-flow"><span>Submit</span><ArrowRight size={18} /><span>Approve</span><ArrowRight size={18} /><span>Settle</span></div></div>
      <div className="login-foot">Enterprise Expense Management <span>BCC75 · PBL</span></div>
    </section>
    <section className="login-panel"><div className="login-form">
      <span className="eyebrow">WELCOME TO NEMO</span>
      <h2>{mode === 'login' ? 'Your workspace awaits.' : mode === 'signup' ? 'Create your account.' : 'Check your email.'}</h2>
      <p className="muted">{mode === 'login' ? 'Sign in with your work email. Your account determines your role and workspace access.' : mode === 'signup' ? 'Verify your work email to join as an Employee. Your administrator assigns your manager and any additional role.' : `Enter the 6-digit code sent to ${email.trim().toLowerCase()}. Codes expire after 10 minutes.`}</p>
      {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}
      {message && <Alert severity="info" sx={{ my: 2 }}>{message}</Alert>}
      {mode === 'signup' && !signupAvailable && <Alert severity="warning" sx={{ my: 2 }}>Email verification is not available yet. Ask your administrator to finish the email setup.</Alert>}
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        {mode === 'signup' && <><TextField label="Full name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} disabled={busy} required slotProps={{ htmlInput: { minLength: 2, maxLength: 100 } }} /><TextField label="Department" value={department} onChange={e => setDepartment(e.target.value)} disabled={busy} required slotProps={{ htmlInput: { minLength: 2, maxLength: 80 } }} /></>}
        {mode !== 'verify' && <><TextField label="Work email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" disabled={busy} required /><TextField label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={busy} required helperText={mode === 'signup' ? 'Use at least 10 characters (up to 72 UTF-8 bytes).' : undefined} slotProps={{ htmlInput: { minLength: mode === 'signup' ? 10 : 1, maxLength: 72 } }} /></>}
        {mode === 'signup' && <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} required />}
        {mode === 'verify' && <TextField label="Verification code" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} required slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6 } }} />}
        <Button type="submit" variant="contained" fullWidth disabled={busy || (mode === 'signup' && !signupAvailable)} endIcon={mode === 'verify' ? <MailCheck size={18} /> : <ArrowRight size={17} />}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Send verification code' : 'Verify & create account'}</Button>
      </form>
      {mode === 'verify' && <Button fullWidth sx={{ mt: 1 }} disabled={busy || remaining > 0} onClick={() => void resend()}>{remaining ? `Resend code in ${remaining}s` : 'Resend code'}</Button>}
      <div className="auth-switch">{mode === 'login' ? <><span>New to Nemo?</span><Button disabled={busy} onClick={() => switchMode('signup')}>Create an account</Button></> : <><span>{mode === 'verify' ? 'Need to change your details?' : 'Already have an account?'}</span><Button disabled={busy} onClick={() => switchMode(mode === 'verify' ? 'signup' : 'login')}>{mode === 'verify' ? 'Start again' : 'Sign in'}</Button></>}</div>
      {mode === 'verify' && <Button fullWidth disabled={busy} onClick={() => switchMode('login')}>Back to sign in</Button>}
      {demo && mode === 'login' && <div className="demo-login"><div className="section-label">EXPLORE THE LOCAL DEMO</div><p>Choose a role to try the expense workflow.</p><div className="demo-roles">{(['employee', 'manager', 'finance', 'admin'] as Role[]).map(role => <Button key={role} variant="outlined" disabled={busy} onClick={() => void submit(role)}>{role === 'admin' ? 'Administrator' : role[0].toUpperCase() + role.slice(1)}</Button>)}</div></div>}
    </div></section>
  </div>;
}
