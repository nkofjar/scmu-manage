import { useBL as useLanguage } from '../../i18n/bl.mjs';
import {useTransport} from '../../i18n/transport.mjs';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LayoutDashboard, ClipboardList, Users, LogOut, Settings, PackageOpen, Calculator, ReceiptText, UserCheck, Building2, Ship } from 'lucide-react';
import Brand from '../common/Brand';
import LanguageSwitcher from '../common/LanguageSwitcher';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/bl-register', label: 'Pengiriman', icon: ClipboardList },
  { to: '/packing-lists', label: 'Packing List', icon: PackageOpen },
  { to: '/driver-trips', label: 'Ritase & Upah', icon: ClipboardList },
  { to: '/tariffs', label: 'Tarif & Biaya', icon: Calculator },
  { to: '/billing-tax', label: 'Tagihan & Pajak', icon: ReceiptText },
  { to: '/approvals', label: 'Persetujuan Direktur', icon: UserCheck },
];

const ADMIN_ITEMS = [
  { to: '/vessels', label: 'Kapal', icon: Ship },
  { to: '/partners', label: 'Mitra/JPT', icon: Building2 },
  { to: '/fleet-drivers', label: 'Kendaraan & Sopir', icon: Users },
  { to: '/delivery-routes', label: 'Rute pengantaran', icon: ClipboardList },
  { to: '/goods-types', label: 'Muatan', icon: PackageOpen },
  { to: '/users', label: 'Users', icon: Users },
];

export default function Sidebar() {
  const {t:bl}=useLanguage(),{t:transport}=useTransport();
  const tr=key=>['Kendaraan & Sopir','Ritase & Upah'].includes(key)?transport(key):bl(key);
  const { user, logout, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const {pathname}=useLocation();

  const handleLogout = () => { logout(); navigate('/login'); };

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group
    ${isActive
      ? 'bg-brand-500/15 text-brand-400 border border-brand-500/30'
      : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`;

  return (
    <aside className="app-sidebar w-60 flex-shrink-0 h-full min-h-0 flex flex-col border-r border-zinc-800 bg-zinc-950">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-zinc-800">
        <Brand />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        <p className="px-3 py-1 text-xs font-semibold text-zinc-600 uppercase tracking-wider mb-2">{tr("Operations")}</p>
        {NAV_ITEMS.map(({ to, label, icon: Icon, exact }) => (
          <NavLink key={to} to={to} end={exact} className={state=>linkClass({isActive:state.isActive||to==='/bl-register'&&pathname.startsWith('/shipments/')})}>
            <Icon size={16} className="flex-shrink-0" />
            <span>{tr(label)}</span>
          </NavLink>
        ))}

        {(
          <>
            <p className="px-3 py-1 text-xs font-semibold text-zinc-600 uppercase tracking-wider mt-4 mb-2">{tr("Master Data")}</p>
            {ADMIN_ITEMS.filter(item=>item.to!=='/users'||isSuperAdmin()).map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={linkClass}>
                <Icon size={16} className="flex-shrink-0" />
                <span>{tr(label)}</span>
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User + Settings */}
      <div className="px-3 py-4 border-t border-zinc-800 space-y-1">
        <div className="px-3 pb-3"><LanguageSwitcher /></div>
        <NavLink to="/settings" className={linkClass}>
          <Settings size={16} className="flex-shrink-0" />
          <span>{tr("Settings")}</span>
        </NavLink>
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-900">
          <div className="w-7 h-7 rounded-full bg-brand-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-brand-400">{user?.name?.[0]?.toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-zinc-200 truncate">{user?.name}</p>
            <p className="text-xs text-zinc-500 truncate">{tr(user?.role?.replace('_', ' '))}</p>
          </div>
          <button onClick={handleLogout} className="text-zinc-500 hover:text-red-400 transition-colors p-1 rounded" title={tr("Logout")}>
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
