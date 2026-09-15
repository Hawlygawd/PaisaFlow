import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from './context/AppContext.jsx';
import { FullPageLoader } from './components/ui.jsx';
import LockScreen from './components/LockScreen.jsx';
import Layout from './components/Layout.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Requests from './pages/Requests.jsx';
import Accounts from './pages/Accounts.jsx';
import Budgets from './pages/Budgets.jsx';
import Goals from './pages/Goals.jsx';
import Recurring from './pages/Recurring.jsx';
import Loans from './pages/Loans.jsx';
import Insights from './pages/Insights.jsx';
import Categories from './pages/Categories.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  const { user, initializing, mode, locked, setLocked } = useApp();

  if (initializing) return <FullPageLoader label="Starting PaisaFlow…" />;

  // PIN lock gate (only when the user enabled it in Settings)
  if (locked) return <LockScreen onUnlocked={() => setLocked(false)} />;

  // The Android app (local mode) has no login — it opens straight into the money.
  // The hosted website keeps email/password auth against the server.
  const needsAuth = mode === 'server';

  return (
    <Routes>
      <Route path="/login" element={needsAuth && !user ? <AuthPage /> : <Navigate to="/" replace />} />
      <Route element={!needsAuth || user ? <Layout /> : <Navigate to="/login" replace />}>
        <Route index element={<Dashboard />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="requests" element={<Requests />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="goals" element={<Goals />} />
        <Route path="recurring" element={<Recurring />} />
        <Route path="loans" element={<Loans />} />
        <Route path="insights" element={<Insights />} />
        <Route path="categories" element={<Categories />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
