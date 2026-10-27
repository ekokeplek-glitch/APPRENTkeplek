import { AppUser, UserPermissions, UserRole } from '../types/ryoko';

// 1. Administrator: Akses ke SEMUA fitur tanpa kecuali (termasuk recovery & snapshot data)
export const DEFAULT_ADMINISTRATOR_PERMISSIONS: UserPermissions = {
  canViewRevenue: true,
  canManageBookings: true,
  canManageTracking: true,
  canManageService: true,
  canManageFleet: true,
  canManageSettings: true,
  canManageUsers: true,
  canAccessRecovery: true,
};

// 2. Owner: Semua fitur KECUALI recovery & snapshot data
export const DEFAULT_OWNER_PERMISSIONS: UserPermissions = {
  canViewRevenue: true,
  canManageBookings: true,
  canManageTracking: true,
  canManageService: true,
  canManageFleet: true,
  canManageSettings: true,
  canManageUsers: true,
  canAccessRecovery: false, // Owner tidak memiliki hak recovery & snapshot
};

// 3. Admin: Seperti Owner dikurangi laporan omset & finansial dan manajemen pengguna
export const DEFAULT_ADMIN_PERMISSIONS: UserPermissions = {
  canViewRevenue: false,    // Dikurangi laporan omset & finansial
  canManageBookings: true,
  canManageTracking: true,
  canManageService: true,
  canManageFleet: true,     // Tarif & unit armada garasi
  canManageSettings: true,  // Pengaturan umum rental
  canManageUsers: false,    // Dikurangi manajemen pengguna
  canAccessRecovery: false,
};

// 4. Operator: Seperti Admin dikurangi tarif & unit armada
export const DEFAULT_OPERATOR_PERMISSIONS: UserPermissions = {
  canViewRevenue: false,
  canManageBookings: true,
  canManageTracking: true,
  canManageService: true,
  canManageFleet: false,    // Dikurangi tarif & unit armada (hanya operasional)
  canManageSettings: false,
  canManageUsers: false,
  canAccessRecovery: false,
};

// 5. Kurir: Hanya lacak unit
export const DEFAULT_COURIER_PERMISSIONS: UserPermissions = {
  canViewRevenue: false,
  canManageBookings: false,
  canManageTracking: true,  // Lacak unit motor
  canManageService: false,
  canManageFleet: false,
  canManageSettings: false,
  canManageUsers: false,
  canAccessRecovery: false,
};

// Alias kompatibilitas
export const DEFAULT_CUSTOM_ADMIN_PERMISSIONS: UserPermissions = DEFAULT_ADMIN_PERMISSIONS;

export function getUserEffectivePermissions(user?: AppUser | null): UserPermissions {
  if (!user) return DEFAULT_COURIER_PERMISSIONS;

  let basePermissions: UserPermissions;
  switch (user.role) {
    case 'administrator':
      basePermissions = DEFAULT_ADMINISTRATOR_PERMISSIONS;
      break;
    case 'owner':
      basePermissions = DEFAULT_OWNER_PERMISSIONS;
      break;
    case 'admin':
      basePermissions = DEFAULT_ADMIN_PERMISSIONS;
      break;
    case 'operator':
      basePermissions = DEFAULT_OPERATOR_PERMISSIONS;
      break;
    case 'kurir':
      basePermissions = DEFAULT_COURIER_PERMISSIONS;
      break;
    default:
      basePermissions = DEFAULT_COURIER_PERMISSIONS;
      break;
  }

  if (user.customPermissions) {
    return {
      ...basePermissions,
      ...user.customPermissions,
    };
  }

  return { ...basePermissions };
}

export const ROLE_LABELS: Record<UserRole, { label: string; badgeColor: string; description: string; icon: string }> = {
  administrator: {
    label: 'Administrator',
    badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    description: 'Akses ke semua fitur tanpa kecuali (termasuk recovery & snapshot)',
    icon: '👑',
  },
  owner: {
    label: 'Owner',
    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    description: 'Akses ke semua fitur kecuali recovery & snapshot data',
    icon: '🏢',
  },
  admin: {
    label: 'Admin',
    badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    description: 'Seperti owner dikurangi laporan omset & finansial dan manajemen pengguna',
    icon: '💼',
  },
  operator: {
    label: 'Operator',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    description: 'Seperti admin dikurangi tarif & unit armada (hanya operasional sewa, lacak, & servis)',
    icon: '📋',
  },
  kurir: {
    label: 'Kurir',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    description: 'Akses khusus pelacakan unit motor (lacak unit)',
    icon: '🛵',
  },
};
