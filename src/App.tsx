import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tabs, type TabItem } from '@/components/Tabs';
import { AuthProvider } from '@/lib/auth';
import { SellerProvider } from '@/lib/sellerContext';
import mathcoLogo from '/assets/mathco-logo.svg';
import { LoginGate } from '@/components/LoginGate';
import { WeeklyScorecard } from '@/views/WeeklyScorecard';
import { VerticalPerformance } from '@/views/VerticalPerformance';
import { IntroTrend } from '@/views/IntroTrend';
import { OperatingMetrics } from '@/views/OperatingMetrics';
import { LtTrends } from '@/views/LtTrends';
import { About } from '@/views/About';
import { Admin } from '@/views/Admin';
import { Forecast } from '@/views/Forecast';
import { ForecastActuals } from '@/views/ForecastActuals';
import { Partnerships } from '@/views/Partnerships';
import { ConnectHealth } from '@/views/ConnectHealth';
import { ClosurePriority } from '@/views/ClosurePriority';
import { FunnelSnapshot } from '@/views/FunnelSnapshot';
import { IndustryAction } from '@/views/IndustryAction';
import { WinLoss } from '@/views/WinLoss';
import { StageConversion } from '@/views/StageConversion';
import { VersionCompare } from '@/views/VersionCompare';
import { Momentum } from '@/views/Momentum';
import { CycleTime } from '@/views/CycleTime';
import { Assumptions } from '@/views/Assumptions';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const appVersion = import.meta.env.VITE_APP_VERSION ?? 'dev';

const mainTabs: TabItem[] = [
  { label: 'Vertical performance', to: '/vertical-performance' },
  { label: 'Weekly scorecard', to: '/' },
  { label: 'Call trends', to: '/intro-trend' },
  { label: 'Weekly operating', to: '/operating' },
  { label: 'LT biweekly trends', to: '/lt-trends' },
  { label: 'About', to: '/about' },
];

const appendixTabs: TabItem[] = [
  { label: 'Admin', to: '/admin' },
  { label: 'Forecast (EV)', to: '/forecast' },
  { label: 'Forecast (actuals)', to: '/forecast-actuals' },
  { label: 'Partnerships', to: '/partnerships' },
  { label: 'Connect health', to: '/connect-health' },
  { label: 'Closure priorities', to: '/closure-priority' },
  { label: 'Funnel snapshot', to: '/funnel' },
  { label: 'Industry action', to: '/industry' },
  { label: 'Won/lost', to: '/win-loss' },
  { label: 'Stage conversion', to: '/stage-conversion' },
  { label: 'Version compare', to: '/compare' },
  { label: 'Momentum', to: '/momentum' },
  { label: 'Cycle time', to: '/cycle-time' },
  { label: 'Assumptions', to: '/assumptions' },
];

function Shell() {
  return (
    <LoginGate>
      <div className="min-h-screen bg-bg-page">
        {/* Header */}
        <header
          className="bg-bg-card px-5 py-3 flex items-center justify-between"
          style={{ borderBottom: '0.5px solid var(--border-hairline)' }}
        >
          <div className="flex items-center gap-3">
            <img src={mathcoLogo} alt="MathCo" className="h-5 w-auto" />
            <span className="text-13 font-medium text-text-primary">Sales reporting</span>
          </div>
          <span className="text-11 text-text-tertiary tabular-nums">{appVersion}</span>
        </header>

        {/* Main nav */}
        <div className="bg-bg-card" style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
          <div className="max-w-[1500px] mx-auto px-5">
            <Tabs tabs={mainTabs} />
          </div>
        </div>

        {/* Appendix nav */}
        <div className="bg-bg-page" style={{ borderBottom: '0.5px solid var(--border-hairline)' }}>
          <div className="max-w-[1500px] mx-auto px-5">
            <Tabs tabs={appendixTabs} className="text-text-tertiary" />
          </div>
        </div>

        {/* View content */}
        <main className="max-w-[1500px] mx-auto px-5 py-5">
          <Routes>
            <Route path="/" element={<WeeklyScorecard />} />
            <Route path="/vertical-performance" element={<VerticalPerformance />} />
            <Route path="/intro-trend" element={<IntroTrend />} />
            <Route path="/operating" element={<OperatingMetrics />} />
            <Route path="/lt-trends" element={<LtTrends />} />
            <Route path="/about" element={<About />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/forecast" element={<Forecast />} />
            <Route path="/forecast-actuals" element={<ForecastActuals />} />
            <Route path="/partnerships" element={<Partnerships />} />
            <Route path="/connect-health" element={<ConnectHealth />} />
            <Route path="/closure-priority" element={<ClosurePriority />} />
            <Route path="/funnel" element={<FunnelSnapshot />} />
            <Route path="/industry" element={<IndustryAction />} />
            <Route path="/win-loss" element={<WinLoss />} />
            <Route path="/stage-conversion" element={<StageConversion />} />
            <Route path="/compare" element={<VersionCompare />} />
            <Route path="/momentum" element={<Momentum />} />
            <Route path="/cycle-time" element={<CycleTime />} />
            <Route path="/assumptions" element={<Assumptions />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </LoginGate>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SellerProvider>
          <BrowserRouter basename="/sales-reporting-dashboard">
            <Shell />
          </BrowserRouter>
        </SellerProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
