export interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminJwtPayload {
  sub: string; // AdminUser.id
  email: string;
}

export interface EnrollmentToken {
  id: string;
  label: string;
  usesRemaining: number;
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
}
