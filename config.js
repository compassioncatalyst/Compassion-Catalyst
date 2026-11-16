/* config.js — how the website finds your Supabase project.
   CONNECT TO SUPABASE HERE: these two values come from Supabase → Project Settings → API Keys.
   The publishable key is meant to be public, so it's safe in a website.
   NEVER paste a secret key (it starts with sb_secret_ or is labeled service_role) into any website file. */
window.CC_CONFIG = {
  SUPABASE_URL: 'https://xmkrkxvlwiclrbbnxmlc.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_4o_F3ytj_LfYQZHXvq426A_ChGFoI4U',

  // The made-up Hope Harbor sample. Logging in with this email opens the sample dashboard
  // (made-up team, numbers and settings, nothing saved). Hope Harbor is never on Find help.
  // Create this user in Supabase → Authentication → Users → Add user (tick "Auto Confirm User").
  DEMO_EMAIL: 'denise@hopeharbor.example'
};
