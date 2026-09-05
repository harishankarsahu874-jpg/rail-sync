import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import useLive from './hooks/useLive.js';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import { useToast } from './components/Toast.jsx';
import LandingPage from './pages/LandingPage.jsx';
import LiveTrackingPage from './pages/LiveTrackingPage.jsx';
import MapPage from './pages/MapPage.jsx';
import StationPage from './pages/StationPage.jsx';
import PassengerPage from './pages/PassengerPage.jsx';
import ControlPage from './pages/ControlPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';

export default function App() {
  const { state, mode, refresh } = useLive();
  const { push } = useToast();
  const seenAlerts = useRef(new Set());

  // Triggered passenger alerts remain global, including on the new public
  // landing and shareable live-train pages.
  useEffect(() => {
    if (!state) return;
    state.alerts?.forEach((alert) => {
      if (alert.status !== 'triggered' || !alert.triggered_at) return;
      const key = `${alert.id}:${alert.triggered_at}`;
      if (!seenAlerts.current.has(key)) {
        seenAlerts.current.add(key);
        push({ kind: 'warn', title: 'Delay alert', body: alert.message });
      }
    });
  }, [state, push]);

  return (
    <Routes>
      <Route path="/" element={<LandingPage state={state} mode={mode} />} />
      <Route path="/live/:trainNumber" element={<LiveTrackingPage state={state} mode={mode} refreshState={refresh} />} />
      <Route path="/*" element={<OperationsShell state={state} mode={mode} />} />
    </Routes>
  );
}

function OperationsShell({ state, mode }) {
  const location = useLocation();
  return (
    <div className="flex h-full bg-ink-950 text-slate-100">
      <Sidebar state={state} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar state={state} mode={mode} title={TITLES[location.pathname] || 'RailSync Operations'} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/network" element={<MapPage state={state} />} />
            <Route path="/stations" element={<StationPage state={state} />} />
            <Route path="/passengers" element={<PassengerPage state={state} />} />
            <Route path="/control" element={<ControlPage state={state} />} />
            <Route path="/analytics" element={<AnalyticsPage state={state} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

const TITLES = {
  '/network': 'Live Network',
  '/stations': 'Station Boards',
  '/passengers': 'Passenger Search & Alerts',
  '/control': 'Control Room',
  '/analytics': 'Historical Analytics & Model Trust',
};
