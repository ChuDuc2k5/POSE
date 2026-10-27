export type Profile = {
  name: string;
  phone: string;
  phoneVerified: boolean;
  notificationsEnabled: boolean;
  avatarPath: string | null;
  avatarUrl?: string | null;
  version: number;
  updatedAt: string | null;
};
