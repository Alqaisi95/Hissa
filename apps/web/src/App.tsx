import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { RequireAuth, RequireRole } from './components/Guards.tsx';
import { Loading } from './components/ui.tsx';
import { Home } from './pages/public/Home.tsx';
import { STAFF_ROLES } from './lib/auth.tsx';

/**
 * Everything below the landing page is split.
 *
 * The build was one 407 kB chunk, so an anonymous visitor opening the
 * marketplace downloaded PoolAdmin (1,077 lines), the disclosure editor, the
 * investment committee and funds operations before the first pool card
 * rendered. None of it is reachable without a staff role.
 *
 * Home stays eager: it is the first paint for most visitors, and splitting it
 * only adds a round trip.
 */
const Marketplace = lazy(() => import('./pages/public/Marketplace.tsx').then((m) => ({ default: m.Marketplace })));
const PoolDetail = lazy(() => import('./pages/public/PoolDetail.tsx').then((m) => ({ default: m.PoolDetail })));
const HowItWorks = lazy(() => import('./pages/public/Content.tsx').then((m) => ({ default: m.HowItWorks })));
const Risks = lazy(() => import('./pages/public/Content.tsx').then((m) => ({ default: m.Risks })));
const Fees = lazy(() => import('./pages/public/Content.tsx').then((m) => ({ default: m.Fees })));
const Faq = lazy(() => import('./pages/public/Content.tsx').then((m) => ({ default: m.Faq })));

const SignIn = lazy(() => import('./pages/investor/Auth.tsx').then((m) => ({ default: m.SignIn })));
const Register = lazy(() => import('./pages/investor/Auth.tsx').then((m) => ({ default: m.Register })));

const Account = lazy(() => import('./pages/investor/Account.tsx').then((m) => ({ default: m.Account })));
const Portfolio = lazy(() => import('./pages/investor/Portfolio.tsx').then((m) => ({ default: m.Portfolio })));
const Checkout = lazy(() => import('./pages/investor/Checkout.tsx').then((m) => ({ default: m.Checkout })));
const OrderStatus = lazy(() => import('./pages/investor/OrderStatus.tsx').then((m) => ({ default: m.OrderStatus })));
const Complaints = lazy(() => import('./pages/investor/Complaints.tsx').then((m) => ({ default: m.Complaints })));
const Notifications = lazy(() => import('./pages/investor/Notifications.tsx').then((m) => ({ default: m.Notifications })));

const ProjectPortal = lazy(() => import('./pages/owner/ProjectPortal.tsx').then((m) => ({ default: m.ProjectPortal })));
const Console = lazy(() => import('./pages/staff/Console.tsx').then((m) => ({ default: m.Console })));

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />

        <Route path="opportunities" element={<Suspense fallback={<Loading rows={5} />}><Marketplace /></Suspense>} />
        <Route path="opportunities/:id" element={<Suspense fallback={<Loading rows={6} />}><PoolDetail /></Suspense>} />
        <Route path="how-it-works" element={<Suspense fallback={<Loading rows={4} />}><HowItWorks /></Suspense>} />
        <Route path="risks" element={<Suspense fallback={<Loading rows={4} />}><Risks /></Suspense>} />
        <Route path="fees" element={<Suspense fallback={<Loading rows={4} />}><Fees /></Suspense>} />
        <Route path="faq" element={<Suspense fallback={<Loading rows={4} />}><Faq /></Suspense>} />

        <Route path="sign-in" element={<Suspense fallback={<Loading rows={3} />}><SignIn /></Suspense>} />
        <Route path="register" element={<Suspense fallback={<Loading rows={3} />}><Register /></Suspense>} />

        <Route path="account" element={<RequireAuth><Suspense fallback={<Loading rows={6} />}><Account /></Suspense></RequireAuth>} />
        <Route path="portfolio" element={<RequireAuth><Suspense fallback={<Loading rows={6} />}><Portfolio /></Suspense></RequireAuth>} />
        <Route path="invest/:poolId" element={<RequireAuth><Suspense fallback={<Loading rows={6} />}><Checkout /></Suspense></RequireAuth>} />
        <Route path="orders/:id" element={<RequireAuth><Suspense fallback={<Loading rows={5} />}><OrderStatus /></Suspense></RequireAuth>} />
        <Route path="complaints" element={<RequireAuth><Suspense fallback={<Loading rows={4} />}><Complaints /></Suspense></RequireAuth>} />
        <Route path="notifications" element={<RequireAuth><Suspense fallback={<Loading rows={4} />}><Notifications /></Suspense></RequireAuth>} />

        <Route path="project" element={<RequireRole roles={['project_owner']}><Suspense fallback={<Loading rows={6} />}><ProjectPortal /></Suspense></RequireRole>} />
        <Route path="console" element={<RequireRole roles={STAFF_ROLES}><Suspense fallback={<Loading rows={8} />}><Console /></Suspense></RequireRole>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
