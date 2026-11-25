import { BrowserRouter, Routes, Route, NavLink, Outlet, Navigate, useNavigate, Link } from 'react-router';
import { session } from './api.js';
import { Icon } from './icons.jsx';
import Login from './pages/Login.jsx';
import Leads from './pages/Leads.jsx';
import LeadDetail from './pages/LeadDetail.jsx';
import CallPage from './pages/CallPage.jsx';
import Knowledge from './pages/Knowledge.jsx';
import Meetings from './pages/Meetings.jsx';
import Insights from './pages/Insights.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  ['/', 'Leads', 'leads'],
  ['/insights', 'Insights', 'insights'],
  ['/meetings', 'Demos', 'meetings'],
  ['/knowledge', 'Knowledge', 'knowledge'],
  ['/settings', 'Agent', 'settings'],
];

function Shell() {
  const navigate = useNavigate();
  if (!session.token) return <Navigate to="/login" replace />;
  return (
    <div className="shell">
      <aside className="rail">
        <Link to="/" className="brand"><span className="brand-mark" aria-hidden="true" />Voice Sales Agent</Link>
        <nav aria-label="Main">
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'}><Icon name={icon} />{label}</NavLink>
          ))}
        </nav>
        <div className="rail-foot">
          <span>Admin</span>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              session.clear();
              navigate('/login');
            }}
          >
            <Icon name="logout" size={16} />Log out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Shell />}>
          <Route index element={<Leads />} />
          <Route path="leads/:id" element={<LeadDetail />} />
          <Route path="call/:id" element={<CallPage />} />
          <Route path="insights" element={<Insights />} />
          <Route path="meetings" element={<Meetings />} />
          <Route path="knowledge" element={<Knowledge />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
