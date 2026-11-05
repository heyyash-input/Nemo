import { useState } from 'react';
import { Alert, Button, TextField } from '@mui/material';
import { ArrowRight, Leaf } from 'lucide-react';
import { errorText, post } from './api';
import type { Role, User } from './types';

/** Display employee signup, password login, and optional local demo shortcuts. */
export function AuthPage({ onLogin, demo }: { onLogin: (user: User) => void; demo: boolean }) {
  const [signup, setSignup] = useState(false);
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** Sign in with credentials or a selected development demo role. */
  async function submit(role?: Role) {
    setError('');
    setBusy(true);
    try {
      const user = role
        ? await post<User>('/auth/demo', { role })
        : await post<User>(signup ? '/auth/signup' : '/auth/login', {
            email: email.trim().toLowerCase(),
            password,
            ...(signup ? { name: name.trim(), department: department.trim() } : {}),
          });
      onLogin(user);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Leaf size={24} />
          </span>
          nemo<span className="brand-dot">.</span>
        </div>
        <div>
          <span className="login-kicker">YOUR WORK. YOUR EXPENSES. IN ORDER.</span>
          <h1>
            Less paperwork.
            <br />
            More peace of mind.
          </h1>
          <p>
            From the first receipt to the final reimbursement.
            <br />A clear path for every business expense.
          </p>
          <div className="login-flow">
            <span>Submit</span>
            <ArrowRight size={18} />
            <span>Approve</span>
            <ArrowRight size={18} />
            <span>Settle</span>
          </div>
        </div>
        <div className="login-foot">
          Enterprise Expense Management <span>BCC75 · PBL</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-form">
          <span className="eyebrow">WELCOME TO NEMO</span>
          <h2>{signup ? 'Create your account.' : 'Your workspace awaits.'}</h2>
          <p className="muted">
            {signup
              ? 'Join as an employee. An administrator must assign your manager before you submit expenses.'
              : 'Sign in with your account email. Your account determines your role and workspace access.'}
          </p>
          {error && (
            <Alert severity="error" sx={{ my: 2 }}>
              {error}
            </Alert>
          )}
          <form
            onSubmit={
              /* Sign in without a browser page reload. */ (event) => {
                event.preventDefault();
                void submit();
              }
            }
          >
            {signup && (
              <>
                <TextField
                  label="Full name"
                  autoComplete="name"
                  value={name}
                  required
                  disabled={busy}
                  onChange={
                    /* Update the new employee's name. */ (event) => setName(event.target.value)
                  }
                  slotProps={{ htmlInput: { minLength: 2, maxLength: 100 } }}
                />
                <TextField
                  label="Department"
                  value={department}
                  required
                  disabled={busy}
                  placeholder="e.g. Engineering"
                  onChange={
                    /* Update the employee's department. */ (event) =>
                      setDepartment(event.target.value)
                  }
                  slotProps={{ htmlInput: { minLength: 2, maxLength: 80 } }}
                />
              </>
            )}
            <TextField
              label="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={/* Update the login email. */ (event) => setEmail(event.target.value)}
              disabled={busy}
              required
            />
            <TextField
              label="Password"
              type="password"
              autoComplete={signup ? 'new-password' : 'current-password'}
              helperText={
                signup ? 'Use at least 10 characters (maximum 72 UTF-8 bytes).' : undefined
              }
              value={password}
              onChange={/* Update the login password. */ (event) => setPassword(event.target.value)}
              disabled={busy}
              required
              slotProps={{
                htmlInput: { minLength: signup ? 10 : 1, maxLength: signup ? 72 : 128 },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={busy}
              endIcon={<ArrowRight size={17} />}
            >
              {busy ? 'Please wait...' : signup ? 'Create account' : 'Sign in'}
            </Button>
          </form>
          <Button
            disabled={busy}
            onClick={
              /* Switch forms and clear sensitive form state. */ () => {
                setSignup(!signup);
                setError('');
                setPassword('');
              }
            }
          >
            {signup ? 'Already have an account? Sign in' : 'New to Nemo? Create an account'}
          </Button>
          {demo && (
            <div className="demo-login">
              <div className="section-label">EXPLORE THE LOCAL DEMO</div>
              <p>Choose a role to try the expense workflow.</p>
              <div className="demo-roles">
                {(['employee', 'manager', 'finance', 'admin'] as Role[]).map(
                  /* Render a login shortcut for each demo role. */ (role) => (
                    <Button
                      key={role}
                      variant="outlined"
                      disabled={busy}
                      onClick={/* Sign in using the chosen demo role. */ () => void submit(role)}
                    >
                      {role === 'admin' ? 'Administrator' : role[0].toUpperCase() + role.slice(1)}
                    </Button>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
