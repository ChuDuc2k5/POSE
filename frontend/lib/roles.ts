export type Role = 'User' | 'Sales' | 'Admin';

export const roleLabels: Record<Role, string> = {
  User: 'Khách hàng',
  Sales: 'Nhân viên tư vấn',
  Admin: 'Quản trị viên',
};

export function roleHome(role: Role) {
  return role === 'Admin' ? '/admin' : role === 'Sales' ? '/sales' : '/';
}

// Every role starts on the shared homepage after signing in; the account menu
// links onward to the role's workspace (roleHome).
export const signedInHome = '/';

export function allowsRole(role: Role, roles: readonly Role[]) {
  return roles.includes(role);
}
