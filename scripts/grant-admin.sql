-- Grant admin access after signing up at /admin-login.html
-- Replace the email with your admin account email, then run:
--   npx @insforge/cli db query "$(cat scripts/grant-admin.sql)"
-- Or paste this in the InsForge dashboard SQL editor:

INSERT INTO admin_users (user_id, email)
SELECT id, email FROM auth.users WHERE email = 'arfatalis451@gmail.com'
ON CONFLICT (user_id) DO NOTHING;
