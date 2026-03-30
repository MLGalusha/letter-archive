export const OWNER_ADMIN_EMAIL = 'masonlgalusha@gmail.com';

export function isOwnerAdminEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }

  return email.trim().toLowerCase() === OWNER_ADMIN_EMAIL;
}
