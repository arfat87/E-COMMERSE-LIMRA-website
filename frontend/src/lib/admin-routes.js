export const ADMIN_LOGIN_PATH = '/admin-login.html';
export const ADMIN_DASHBOARD_PATH = '/admin.html';

export function getAdminLoginUrl(redirectTo = ADMIN_DASHBOARD_PATH) {
  const safe = redirectTo.startsWith('/') ? redirectTo : ADMIN_DASHBOARD_PATH;
  return `${ADMIN_LOGIN_PATH}?redirect=${encodeURIComponent(safe)}`;
}

export function getRedirectTarget(fallback = ADMIN_DASHBOARD_PATH) {
  const param = new URLSearchParams(window.location.search).get('redirect');
  if (!param || !param.startsWith('/') || param.startsWith('//')) return fallback;
  return param;
}

export function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}
