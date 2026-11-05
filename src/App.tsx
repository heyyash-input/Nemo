import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Avatar, Button, Chip, IconButton, Snackbar } from '@mui/material';
import {
  LayoutDashboard,
  Receipt,
  CheckCheck,
  Landmark,
  ShieldCheck,
  Users,
  History,
  LogOut,
  Menu,
  X,
  Leaf,
  Settings,
  ChevronDown,
} from 'lucide-react';
import { api, errorText, post } from './api';
import type { Claim, Policy, Role, User } from './types';
import { Loading } from './components';
import { Dashboard, ExpenseList, Transactions, PolicyPage, AuditPage, AccountPage } from './pages';
import { ExpenseEditor, ClaimDetail } from './expenses';
import { UsersPage } from './users';
import { AuthPage } from './AuthPage';

interface Workspace {
  user: User;
  claims: Claim[];
  policy: Policy;
  refresh: () => Promise<void>;
  notify: (text: string) => void;
  demo: boolean;
}
const Context = createContext<Workspace | null>(null);
/** Read the signed-in user, claims, policy, and shared workspace actions. */
export const useWorkspace = () => useContext(Context)!;
const roleLabels: Record<Role, string> = {
  employee: 'Employee',
  manager: 'Manager',
  finance: 'Finance',
  admin: 'Administrator',
};

/** Load the session and render the workspace navigation and permitted screens. */
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [booting, setBooting] = useState(true);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [drawer, setDrawer] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const refresh = useCallback(
    /* Reload claims and company policy together. */ async () => {
      const [nextClaims, nextPolicy] = await Promise.all([
        api<Claim[]>('/claims'),
        api<Policy>('/policy'),
      ]);
      setClaims(nextClaims);
      setPolicy(nextPolicy);
    },
    [],
  );
  useEffect(
    /* Load public configuration and restore the session on first render. */ () => {
      Promise.all([
        api<{ demo: boolean }>('/config'),
        api<User>('/auth/me').catch(/* Treat a missing session as signed out. */ () => null),
      ])
        .then(
          /* Apply the startup configuration and current user. */ ([config, me]) => {
            setDemo(config.demo);
            setUser(me);
          },
        )
        .catch(/* Show the startup error. */ (e) => setError(errorText(e)))
        .finally(/* Finish the initial loading state. */ () => setBooting(false));
      /** Clear private workspace state when the API reports an expired session. */
      const expired = () => {
        setUser(null);
        setPolicy(null);
        setClaims([]);
      };
      window.addEventListener('session-expired', expired);
      return /* Remove the session-expiry listener when the component unmounts. */ () =>
        window.removeEventListener('session-expired', expired);
    },
    [],
  );
  useEffect(
    /* Load workspace data after a user signs in. */ () => {
      if (user) {
        setError('');
        refresh().catch(/* Show the workspace refresh error. */ (e) => setError(errorText(e)));
      }
    },
    [user, refresh],
  );
  useEffect(
    /* Close the mobile navigation after changing pages. */ () => {
      setDrawer(false);
    },
    [location.pathname],
  );
  /** End the server session, clear workspace data, and return to the login page. */
  async function logout() {
    try {
      await post('/auth/logout');
      setUser(null);
      setPolicy(null);
      setClaims([]);
      navigate('/');
    } catch (e) {
      setToast(errorText(e));
    }
  }
  if (booting) return <Loading />;
  if (!user)
    return (
      <>
        {error && <Alert severity="error">Unable to connect to the server. {error}</Alert>}
        <AuthPage
          demo={demo}
          onLogin={
            /* Store the signed-in user and open the dashboard. */ (next) => {
              setUser(next);
              navigate('/');
            }
          }
        />
      </>
    );
  if (!policy)
    return error ? (
      <div className="loading">
        <Alert severity="error">{error}</Alert>
        <Button
          onClick={
            /* Retry loading the workspace. */ () =>
              refresh().catch(/* Show the retry error. */ (e) => setError(errorText(e)))
          }
        >
          Retry
        </Button>
        <Button onClick={/* Sign out from the loading-error screen. */ () => void logout()}>
          Sign out
        </Button>
      </div>
    ) : (
      <Loading />
    );
  const pending = claims.filter(
    /* Count claims awaiting this user's review. */ (c) =>
      c.ownerId._id !== user._id &&
      (user.role === 'manager'
        ? c.status === 'submitted' && c.managerId?._id === user._id
        : c.status === 'manager_approved'),
  ).length;
  const navItems = [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
    { to: '/expenses', label: 'My expenses', icon: Receipt },
    ...(user.role === 'admin'
      ? [{ to: '/all-expenses', label: 'All expenses', icon: Receipt }]
      : []),
    ...(['manager', 'finance'].includes(user.role)
      ? [{ to: '/approvals', label: 'Approvals', icon: CheckCheck, count: pending }]
      : []),
    ...(['finance', 'admin'].includes(user.role)
      ? [{ to: '/transactions', label: 'Reimbursements', icon: Landmark }]
      : []),
  ];
  const adminItems = [
    { to: '/policies', label: 'Expense policy', icon: ShieldCheck },
    ...(user.role === 'admin'
      ? [
          { to: '/users', label: 'People & roles', icon: Users },
          { to: '/audit', label: 'Audit trail', icon: History },
        ]
      : []),
  ];
  const pageName =
    [...navItems, ...adminItems, { to: '/account', label: 'My account' }].find(
      /* Find the title for the current route. */ (n) => n.to === location.pathname,
    )?.label || 'Expense details';
  return (
    <Context.Provider value={{ user, claims, policy, refresh, notify: setToast, demo }}>
      <div className="app-shell">
        {drawer && (
          <button
            className="sidebar-scrim"
            aria-label="Close navigation"
            onClick={
              /* Close the navigation when its backdrop is clicked. */ () => setDrawer(false)
            }
          />
        )}
        <aside className={`sidebar ${drawer ? 'is-open' : ''}`}>
          <NavLink to="/" className="brand">
            <span className="brand-mark">
              <Leaf size={22} />
            </span>
            nemo<span className="brand-dot">.</span>
          </NavLink>
          <IconButton
            className="close-nav"
            aria-label="Close navigation"
            onClick={/* Close the navigation with its close button. */ () => setDrawer(false)}
          >
            <X size={20} />
          </IconButton>
          <div className="workspace-card">
            <span className="company-monogram">N</span>
            <div>
              <strong>Nemo Workspace</strong>
              <span>{demo ? 'College demo' : 'Enterprise workspace'}</span>
            </div>
            <ChevronDown size={15} />
          </div>
          <div className="nav-label">WORKSPACE</div>
          <nav>
            {navItems.map(
              /* Render a workspace navigation link. */ (n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === '/'}
                  className={
                    /* Mark the link for the current route as active. */ ({ isActive }) =>
                      `nav-item ${isActive ? 'active' : ''}`
                  }
                >
                  <n.icon size={19} strokeWidth={1.7} />
                  <span>{n.label}</span>
                  {'count' in n && Boolean(n.count) && <span className="nav-count">{n.count}</span>}
                </NavLink>
              ),
            )}
          </nav>
          <div className="nav-label">MANAGEMENT</div>
          <nav>
            {adminItems.map(
              /* Render an administration navigation link. */ (n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={
                    /* Mark the link for the current route as active. */ ({ isActive }) =>
                      `nav-item ${isActive ? 'active' : ''}`
                  }
                >
                  <n.icon size={19} strokeWidth={1.7} />
                  <span>{n.label}</span>
                </NavLink>
              ),
            )}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-tip">
              <ShieldCheck size={23} />
              <strong>Every expense accounted for.</strong>
              <p>Clear approvals. Complete records. One shared workspace.</p>
            </div>
            <button
              className="nav-item"
              onClick={/* Sign out from the sidebar. */ () => void logout()}
            >
              <LogOut size={18} />
              Sign out
            </button>
            <div className="sidebar-version">
              NEMO <span>V1.0 · BCC75</span>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumbs">
              <IconButton
                className="open-nav"
                aria-label="Open navigation"
                onClick={/* Open the mobile navigation. */ () => setDrawer(true)}
              >
                <Menu size={21} />
              </IconButton>
              <span>Workspace</span>
              <span className="breadcrumb-slash">/</span>
              <strong>{pageName}</strong>
            </div>
            <div className="topbar-right">
              {demo && <Chip size="small" label="Demo workspace" className="demo-chip" />}
              <button
                className="profile-button"
                onClick={/* Open account settings. */ () => navigate('/account')}
              >
                <Avatar
                  sx={{
                    width: 34,
                    height: 34,
                    bgcolor: '#e8e9df',
                    color: '#4c6048',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {user.name
                    .split(' ')
                    .map(/* Take the first letter of each name for the avatar. */ (n) => n[0])
                    .slice(0, 2)
                    .join('')}
                </Avatar>
                <span>
                  <strong>{user.name}</strong>
                  <small>{roleLabels[user.role]}</small>
                </span>
                <Settings size={16} />
              </button>
            </div>
          </header>
          <main className="main-content">
            {user.role === 'employee' && !user.managerId && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Your account is ready. You can save expense drafts now. Ask your administrator to
                assign a reporting manager before submitting claims.
              </Alert>
            )}
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/expenses" element={<ExpenseList />} />
              <Route
                path="/all-expenses"
                element={user.role === 'admin' ? <ExpenseList company /> : <Navigate to="/" />}
              />
              <Route path="/expenses/new" element={<ExpenseEditor />} />
              <Route path="/expenses/:id/edit" element={<ExpenseEditor />} />
              <Route path="/expenses/:id" element={<ClaimDetail />} />
              <Route
                path="/approvals"
                element={
                  ['manager', 'finance'].includes(user.role) ? (
                    <ExpenseList approvals />
                  ) : (
                    <Navigate to="/" />
                  )
                }
              />
              <Route
                path="/transactions"
                element={
                  ['finance', 'admin'].includes(user.role) ? <Transactions /> : <Navigate to="/" />
                }
              />
              <Route path="/policies" element={<PolicyPage />} />
              <Route
                path="/users"
                element={user.role === 'admin' ? <UsersPage /> : <Navigate to="/" />}
              />
              <Route
                path="/audit"
                element={user.role === 'admin' ? <AuditPage /> : <Navigate to="/" />}
              />
              <Route
                path="/account"
                element={
                  <AccountPage
                    onLogout={
                      /* Clear workspace data after a password change signs the user out. */ () => {
                        setUser(null);
                        setPolicy(null);
                        setClaims([]);
                      }
                    }
                  />
                }
              />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
            <footer className="content-footer">
              <span>Nemo · Enterprise Expense Management</span>
              <span>BCC75 / Built for better expense management</span>
            </footer>
          </main>
        </div>
      </div>
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={/* Dismiss the notification. */ () => setToast('')}
        message={toast}
      />
    </Context.Provider>
  );
}
