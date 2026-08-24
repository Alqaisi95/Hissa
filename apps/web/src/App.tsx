import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { RequireAuth, RequireRole } from './components/Guards.tsx';
import { Home } from './pages/public/Home.tsx';
import { HowItWorks, Risks, Fees, Faq } from './pages/public/Content.tsx';
import { Marketplace } from './pages/public/Marketplace.tsx';
import { PoolDetail } from './pages/public/PoolDetail.tsx';
import { SignIn, Register } from './pages/investor/Auth.tsx';
import { Account } from './pages/investor/Account.tsx';
import { Checkout } from './pages/investor/Checkout.tsx';
import { OrderStatus } from './pages/investor/OrderStatus.tsx';
import { Portfolio } from './pages/investor/Portfolio.tsx';
import { Complaints } from './pages/investor/Complaints.tsx';
import { ProjectPortal } from './pages/owner/ProjectPortal.tsx';
import { Console } from './pages/staff/Console.tsx';
import { STAFF_ROLES } from './lib/auth.tsx';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="opportunities" element={<Marketplace />} />
        <Route path="opportunities/:id" element={<PoolDetail />} />
        <Route path="how-it-works" element={<HowItWorks />} />
        <Route path="risks" element={<Risks />} />
        <Route path="fees" element={<Fees />} />
        <Route path="faq" element={<Faq />} />

        <Route path="sign-in" element={<SignIn />} />
        <Route path="register" element={<Register />} />

        <Route path="account" element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="portfolio" element={<RequireAuth><Portfolio /></RequireAuth>} />
        <Route path="invest/:poolId" element={<RequireAuth><Checkout /></RequireAuth>} />
        <Route path="orders/:id" element={<RequireAuth><OrderStatus /></RequireAuth>} />
        <Route path="complaints" element={<RequireAuth><Complaints /></RequireAuth>} />

        <Route path="project" element={<RequireRole roles={['project_owner']}><ProjectPortal /></RequireRole>} />
        <Route path="console" element={<RequireRole roles={STAFF_ROLES}><Console /></RequireRole>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
