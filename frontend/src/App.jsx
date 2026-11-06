import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout/Layout';
import Login from './pages/Login';
import Journeys from './pages/Shipments/Journeys';
import JourneyDetail from './pages/Shipments/JourneyDetail';
import Dashboard from './pages/Dashboard';
import BLDetail from './pages/BL/BLDetail';
import UserManagement from './pages/Users/UserManagement';
import SettingsPage from './pages/Settings/SettingsPage';
import PackingOverview from './pages/Shipments/JourneyPackingOverview';
import BillingTax from './pages/Operations/BillingTax';
import TariffCosts from './pages/Operations/TariffCosts';
import DirectorApprovals from './components/jpt/DirectorApproval';
import CompanyList from './pages/Companies/CompanyList';
import FleetDrivers from './pages/Fleet/FleetDrivers';
import DriverTrips from './pages/Operations/DriverTrips';
import DeliveryRoutes from './pages/Masters/DeliveryRoutes';
import GoodsTypes from './pages/Masters/GoodsTypes';
import Vessels,{VesselDetail} from './pages/Vessels';
import { LanguageProvider } from './i18n/LanguageContext';

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="bl-register" element={<Journeys />} />
        <Route path="bl-register/trash" element={<Journeys trash />} />
        <Route path="bl-register/new" element={<Navigate to="/bl-register?create=1" replace />} />
        <Route path="shipments/:id" element={<JourneyDetail />} />
        <Route path="bl-register/:id" element={<BLDetail />} />
        <Route path="packing-lists" element={<PackingOverview />} />
        <Route path="fleet-drivers" element={<FleetDrivers />} />
        <Route path="driver-trips" element={<DriverTrips />} />
        <Route path="delivery-routes" element={<DeliveryRoutes />} />
        <Route path="goods-types" element={<GoodsTypes />} />
        <Route path="tariffs" element={<TariffCosts />} />
        <Route path="billing-tax" element={<BillingTax />} />
        <Route path="approvals" element={<DirectorApprovals />} />
        <Route path="partners" element={<CompanyList />} />
        <Route path="vessels" element={<Vessels />} />
        <Route path="vessels/:id" element={<VesselDetail />} />
        <Route path="vessels/:id/voyages/:voyageId" element={<VesselDetail />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </LanguageProvider>
  );
}
