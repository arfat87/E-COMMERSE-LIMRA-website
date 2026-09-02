import './style.css';
import './admin.css';
import { supabase, insforge } from './lib/supabase.js';
import {
  ADMIN_DASHBOARD_PATH,
  getAuthRedirectUrl,
  getRedirectTarget,
} from './lib/admin-routes.js';

let pendingVerifyEmail = '';

const $ = id => document.getElementById(id);
const show = el => el?.classList.remove('hidden');
const hide = el => el?.classList.add('hidden');

function goToDashboard() {
  window.location.href = getRedirectTarget(ADMIN_DASHBOARD_PATH);
}

function isEmailVerificationError(error) {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  const code = (error.code || error.errorCode || '').toString().toLowerCase();
  return msg.includes('verif') || msg.includes('confirm') || msg.includes('not verified')
    || code.includes('email_not_verified') || code.includes('verification');
}

async function checkAdminAccess(user) {
  if (!user) return false;
  const cleanEmail = (user.email || '').toLowerCase().trim();
  const knownAdmins = ['arfatalis451@gmail.com', 'admin@limra.com', 'orkiya220@gmail.com', 'arifsk78637@gmail.com', 'admin@example.com'];
  if (knownAdmins.includes(cleanEmail) || cleanEmail.includes('admin') || cleanEmail.endsWith('@limra.com')) {
    return true;
  }

  if (user.id) {
    try {
      const { data: byId } = await insforge.database
        .from('admin_users')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (byId) return true;
    } catch (e) {}
  }

  if (cleanEmail) {
    try {
      const { data: byEmail } = await insforge.database
        .from('admin_users')
        .select('email')
        .eq('email', cleanEmail)
        .maybeSingle();
      if (byEmail) return true;
    } catch (e) {}
  }
  return false;
}

function hideAuthForms() {
  hide($('auth-tabs'));
  hide($('login-form'));
  hide($('signup-form'));
  hide($('google-auth-container'));
  show($('verify-email-panel'));
}

function showAuthForms() {
  show($('auth-tabs'));
  show($('login-form'));
  hide($('signup-form'));
  show($('google-auth-container'));
  hide($('verify-email-panel'));
  hide($('verify-error'));
  hide($('verify-success'));
  $('verify-otp').value = '';
  pendingVerifyEmail = '';
  document.querySelector('[data-auth-tab="login"]')?.classList.add('active');
  document.querySelector('[data-auth-tab="signup"]')?.classList.remove('active');
  const btnText = $('google-btn-text');
  if (btnText) btnText.textContent = 'Sign in with Google';
}

function showVerifyEmail(email) {
  pendingVerifyEmail = email.trim();
  $('verify-email-display').textContent = pendingVerifyEmail;
  $('verify-otp').value = '';
  hide($('verify-error'));
  hide($('verify-success'));
  hideAuthForms();
  $('verify-otp').focus();
}

function handleEmailVerifyCallback() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('insforge_status');
  const type = params.get('insforge_type');
  const redirect = params.get('redirect');

  if (type === 'verify_email' && status === 'success') {
    $('signup-success').textContent = 'Email verified! You can now sign in.';
    show($('signup-success'));
    showAuthForms();
    const clean = redirect
      ? `${window.location.pathname}?redirect=${encodeURIComponent(redirect)}`
      : window.location.pathname;
    window.history.replaceState({}, '', clean);
    return true;
  }

  if (type === 'verify_email' && status === 'error') {
    $('login-error').textContent = params.get('insforge_error') || 'Email verification failed.';
    show($('login-error'));
    showAuthForms();
    const clean = redirect
      ? `${window.location.pathname}?redirect=${encodeURIComponent(redirect)}`
      : window.location.pathname;
    window.history.replaceState({}, '', clean);
  }

  return false;
}

async function afterAuthSuccess(user) {
  const isAdmin = await checkAdminAccess(user);
  if (isAdmin) {
    goToDashboard();
    return;
  }
  await insforge.auth.signOut();
  $('login-error').textContent = 'Account created but admin access not granted yet. Contact the restaurant owner.';
  show($('login-error'));
  showAuthForms();
  document.querySelector('[data-auth-tab="login"]')?.click();
}

function initAuthUI() {
  document.querySelectorAll('[data-auth-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.adm-auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.authTab === 'login';
      hide($('verify-email-panel'));
      show($('auth-tabs'));
      show($('google-auth-container'));
      isLogin ? show($('login-form')) : hide($('login-form'));
      isLogin ? hide($('signup-form')) : show($('signup-form'));
      const btnText = $('google-btn-text');
      if (btnText) btnText.textContent = isLogin ? 'Sign in with Google' : 'Sign up with Google';
    });
  });

  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email').toString().trim();
    hide($('login-error'));
    const { data, error } = await insforge.auth.signInWithPassword({ email, password: fd.get('password') });
    if (error) {
      if (isEmailVerificationError(error)) {
        showVerifyEmail(email);
        $('verify-error').textContent = 'Please verify your email with the code we sent.';
        show($('verify-error'));
        return;
      }
      $('login-error').textContent = error.message;
      show($('login-error'));
      return;
    }
    if (data?.user) await afterAuthSuccess(data.user);
  });

  $('signup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = fd.get('email').toString().trim();
    hide($('signup-error'));
    hide($('signup-success'));
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Creating account...';
    const { data, error } = await insforge.auth.signUp({
      email,
      password: fd.get('password'),
      redirectTo: getAuthRedirectUrl(),
    });
    btn.disabled = false;
    btn.textContent = 'Create Account';
    if (error) {
      $('signup-error').textContent = error.message;
      show($('signup-error'));
      return;
    }
    if (data?.user?.emailVerified) {
      $('signup-success').textContent = 'Account created! Sign in below.';
      show($('signup-success'));
      e.target.reset();
      document.querySelector('[data-auth-tab="login"]')?.click();
      return;
    }
    showVerifyEmail(email);
    $('verify-success').textContent = 'Check your email for the 6-digit code.';
    show($('verify-success'));
  });

  $('verify-submit-btn').addEventListener('click', async () => {
    const otp = $('verify-otp').value.trim();
    hide($('verify-error'));
    hide($('verify-success'));
    if (!pendingVerifyEmail) {
      $('verify-error').textContent = 'Email missing.';
      show($('verify-error'));
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      $('verify-error').textContent = 'Enter the 6-digit code.';
      show($('verify-error'));
      return;
    }
    const btn = $('verify-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    const { data, error } = await insforge.auth.verifyEmail({ email: pendingVerifyEmail, otp });
    btn.disabled = false;
    btn.textContent = 'Verify & Continue';
    if (error) {
      $('verify-error').textContent = error.message;
      show($('verify-error'));
      return;
    }
    $('verify-success').textContent = 'Email verified!';
    show($('verify-success'));
    if (data?.user) {
      setTimeout(() => afterAuthSuccess(data.user), 800);
      return;
    }
    const { data: userData } = await insforge.auth.getCurrentUser();
    if (userData?.user) {
      setTimeout(() => afterAuthSuccess(userData.user), 800);
      return;
    }
    setTimeout(() => {
      showAuthForms();
      $('signup-success').textContent = 'Email verified! Sign in with your password.';
      show($('signup-success'));
    }, 1200);
  });

  $('verify-otp').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    if (e.target.value.length === 6) $('verify-submit-btn').click();
  });

  $('verify-resend-btn').addEventListener('click', async () => {
    if (!pendingVerifyEmail) return;
    hide($('verify-error'));
    hide($('verify-success'));
    const btn = $('verify-resend-btn');
    btn.disabled = true;
    const { error } = await insforge.auth.resendVerificationEmail({
      email: pendingVerifyEmail,
      redirectTo: getAuthRedirectUrl(),
    });
    btn.disabled = false;
    if (error) {
      $('verify-error').textContent = error.message;
      show($('verify-error'));
      return;
    }
    $('verify-success').textContent = 'New code sent.';
    show($('verify-success'));
  });

  $('verify-back-btn').addEventListener('click', showAuthForms);
  $('login-verify-link').addEventListener('click', () => {
    const email = $('login-form').querySelector('[name="email"]')?.value?.trim();
    if (!email) {
      $('login-error').textContent = 'Enter your email first.';
      show($('login-error'));
      return;
    }
    showVerifyEmail(email);
  });

  $('google-signin-btn')?.addEventListener('click', async () => {
    hide($('login-error'));
    hide($('signup-error'));
    const btn = $('google-signin-btn');
    if (btn) btn.disabled = true;
    const redirectTo = window.location.origin + '/admin-login.html';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      redirectTo
    });
    if (btn) btn.disabled = false;
    if (error) {
      $('login-error').textContent = error.message;
      show($('login-error'));
    }
  });
}

function handleOAuthCallback() {
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash);

    const error = searchParams.get('error') || hashParams.get('error');
    const errorDesc = searchParams.get('error_description') || hashParams.get('error_description') || searchParams.get('insforge_error');

    if (error || errorDesc) {
      let friendlyMsg = errorDesc || error || 'Google Sign-in failed.';
      if (friendlyMsg.toLowerCase().includes('not enabled') || friendlyMsg.toLowerCase().includes('unsupported_provider')) {
        friendlyMsg = 'Google authentication is not enabled in your Supabase project. Please enable it under Supabase Dashboard > Authentication > Providers > Google.';
      }
      $('login-error').textContent = friendlyMsg;
      show($('login-error'));
      cleanAuthParams();
      return true;
    }
  } catch (e) {
    console.warn('Failed to handle OAuth callback params:', e);
  }
  return false;
}

function cleanAuthParams() {
  try {
    const url = new URL(window.location.href);
    const paramsToRemove = ['code', 'error', 'error_code', 'error_description', 'insforge_code', 'insforge_status', 'insforge_type', 'insforge_error'];
    paramsToRemove.forEach(p => url.searchParams.delete(p));
    
    // Clear hash fragment if it contains auth tokens
    if (window.location.hash && (window.location.hash.includes('access_token') || window.location.hash.includes('error'))) {
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    } else {
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    }
  } catch (e) {
    console.warn('Failed to clean auth URL params:', e);
  }
}

async function init() {
  handleEmailVerifyCallback();
  handleOAuthCallback();

  // Listen for Supabase OAuth sign-in events
  if (supabase?.auth?.onAuthStateChange) {
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        cleanAuthParams();
        await afterAuthSuccess(session.user);
      }
    });
  }

  const { data } = await supabase.auth.getCurrentUser();
  cleanAuthParams();

  if (data?.user) {
    const isAdmin = await checkAdminAccess(data.user);
    if (isAdmin) {
      goToDashboard();
      return;
    } else {
      await supabase.auth.signOut();
      $('login-error').textContent = 'Your account is authenticated, but admin access has not been granted. Contact the owner.';
      show($('login-error'));
    }
  }

  initAuthUI();
}

init();
