export interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminJwtPayload {
  sub: string; // AdminUser.id
  email: string;
  sid?: string; // AdminSession.id - tokens without one (issued before sessions existed) are refused
}

export interface EnrollmentToken {
  id: string;
  label: string;
  usesRemaining: number;
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
}
