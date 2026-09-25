import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { ToastProvider, DialogProvider, Loading } from './components/ui.jsx';
import { Guard, Soon } from './components/common.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Account, { ForceChangePassword } from './pages/Account.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Alerts from './pages/Alerts.jsx';
import VehicleList from './pages/vehicles/VehicleList.jsx';
import VehicleForm from './pages/vehicles/VehicleForm.jsx';
import VehicleDetail from './pages/vehicles/VehicleDetail.jsx';
import DriverList from './pages/drivers/DriverList.jsx';
import DriverForm from './pages/drivers/DriverForm.jsx';
import DriverDetail from './pages/drivers/DriverDetail.jsx';
import Users, { PermissionsOverview } from './pages/admin/Users.jsx';
import UserForm from './pages/admin/UserForm.jsx';
import Audit from './pages/admin/Audit.jsx';
import AccessLog from './pages/admin/AccessLog.jsx';
import Settings from './pages/Settings.jsx';
import FuelingForm from './pages/fuel/FuelingForm.jsx';
import FuelingList from './pages/fuel/FuelingList.jsx';
import FuelingDetail from './pages/fuel/FuelingDetail.jsx';
import { FuelOrderList, FuelOrderDetail } from './pages/fuel/FuelOrders.jsx';
import FuelAverages from './pages/fuel/FuelAverages.jsx';
import MaintenanceList from './pages/maint/MaintenanceList.jsx';
import MaintenanceForm from './pages/maint/MaintenanceForm.jsx';
import MaintenanceDetail from './pages/maint/MaintenanceDetail.jsx';
import OilChanges from './pages/maint/OilChanges.jsx';
import Calendar from './pages/maint/Calendar.jsx';
import { ServiceOrderList, ServiceOrderDetail } from './pages/maint/ServiceOrders.jsx';
import { ALL_ITEMS } from './lib/nav.js';

function Home() {
  const { can } = useAuth();
  if (can('dashboard')) return <Dashboard />;
  if (can('veiculos')) return <Navigate to="/veiculos" replace />;
  return <Alerts />;
}

function AppRoutes() {
  const { user } = useAuth();
  if (user === undefined) return <Loading />;
  if (!user) return <Login />;
  if (user.must_change_password) return <ForceChangePassword />;

  const soonPaths = ALL_ITEMS.filter((i) => i.phase).map((i) => i.path);

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/alertas" element={<Alerts />} />

        <Route path="/veiculos" element={<Guard module="veiculos"><VehicleList group="frota" /></Guard>} />
        <Route path="/implementos" element={<Guard module="veiculos"><VehicleList group="implementos" key="imp" /></Guard>} />
        <Route path="/veiculos/novo" element={<VehicleForm />} />
        <Route path="/veiculos/:id" element={<Guard module="veiculos"><VehicleDetail /></Guard>} />
        <Route path="/veiculos/:id/editar" element={<VehicleForm />} />

        <Route path="/motoristas" element={<Guard module="motoristas"><DriverList /></Guard>} />
        <Route path="/motoristas/novo" element={<DriverForm />} />
        <Route path="/motoristas/:id" element={<Guard module="motoristas"><DriverDetail /></Guard>} />
        <Route path="/motoristas/:id/editar" element={<DriverForm />} />

        <Route path="/abastecimentos" element={<FuelingList />} />
        <Route path="/abastecimentos/novo" element={<FuelingForm />} />
        <Route path="/abastecimentos/ordens" element={<FuelOrderList />} />
        <Route path="/abastecimentos/ordens/:id" element={<FuelOrderDetail />} />
        <Route path="/abastecimentos/medias" element={<FuelAverages />} />
        <Route path="/abastecimentos/:id" element={<FuelingDetail />} />
        <Route path="/abastecimentos/:id/editar" element={<FuelingForm />} />

        <Route path="/manutencao/os" element={<ServiceOrderList />} />
        <Route path="/manutencao/os/:id" element={<ServiceOrderDetail />} />
        <Route path="/manutencao/preventivas" element={<MaintenanceList type="preventiva" key="prev" />} />
        <Route path="/manutencao/corretivas" element={<MaintenanceList type="corretiva" key="corr" />} />
        <Route path="/manutencao/oleo" element={<OilChanges />} />
        <Route path="/manutencao/calendario" element={<Calendar />} />
        <Route path="/manutencao/nova" element={<MaintenanceForm />} />
        <Route path="/manutencao/:id" element={<MaintenanceDetail />} />
        <Route path="/manutencao/:id/editar" element={<MaintenanceForm />} />

        <Route path="/admin/usuarios" element={<Users />} />
        <Route path="/admin/usuarios/novo" element={<UserForm />} />
        <Route path="/admin/usuarios/:id" element={<UserForm />} />
        <Route path="/admin/permissoes" element={<PermissionsOverview />} />
        <Route path="/admin/auditoria" element={<Audit />} />
        <Route path="/admin/acessos" element={<AccessLog />} />
        <Route path="/configuracoes" element={<Settings />} />
        <Route path="/minha-conta" element={<Account />} />

        {soonPaths.map((p) => (
          <Route key={p} path={p} element={<Soon />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <DialogProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </DialogProvider>
      </ToastProvider>
    </HashRouter>
  );
}
