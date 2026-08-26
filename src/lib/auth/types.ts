export type UserRole = 'admin' | 'fbp';
export type Tower = 'vcp' | 'inv';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
}
