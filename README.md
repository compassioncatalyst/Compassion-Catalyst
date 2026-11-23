# Compassion Catalyst website

Plain HTML, CSS and JavaScript. No build step. Cloudflare Pages serves these files straight from GitHub.

## Pages

| Address | What it is |
|---|---|
| `/` (index.html) | Home |
| `/directory` | Find help |
| `/get-help` | Get help: pick a need and a ZIP code |
| `/about`, `/for-organizations` | Info pages |
| `/organizations` | Short link that goes to the organization log-in page (see `_redirects`) |
| `/login`, `/signup`, `/claim` | Log in, add your organization, claim a listing |
| `/dashboard` | Organization dashboard. Everyone lands here after logging in. If an account has more than one dashboard (several organizations, requests still waiting or not approved, or the Admin page), it asks which one to open, unless the person chose one to open automatically. Add `?pick=1` to see that choice again |
| `/account` | Only used by the “Forgot password?” email, to choose a new password. Anyone else is sent to their dashboard |
| `/join` | Page for teammates invited from the dashboard |
| `/admin` | The Admin page: requests, contact changes, reports, all listings, your team. Only site admins can use it |

## Files

- `config.js`: the Supabase address, the **publishable** key, and the Hope Harbor sample email. Never put a secret key in any file here.
- `connect.js`: talks to Supabase.
- `screens.js` + `app.js`: the public pages.
- `dash-screens.js` + `dash-app.js`: the organization dashboard.
- `admin-screens.js` + `admin-app.js`: the Admin page.
- `account.js`, `join.js`: the new-password page and the join page.
- `data.js`: a saved copy of the directory, used only if Supabase can't be reached. It also holds the made-up Hope Harbor sample.
- `_redirects`: short addresses such as `/organizations`.

## Who can see what

The database enforces every rule below with Row Level Security, so nobody gets around them by changing website files.

- Admin page: only accounts with `is_admin = true`. Roles: Owner and Admin approve, verify, edit and manage the team; Reviewers move reports along and post team updates; Viewers only look. Add people under My team.
- Dashboard: only members of an approved organization, and only for their own organization. People whose request is waiting can set up their listing; changes go live when it's approved. A request that wasn't approved can be deleted from its dashboard.
- Phone, email, website and address changes wait for an admin's approval before they go live.
- Hope Harbor: log in with the sample email in `config.js` to see the sample dashboard. Nothing in it is saved, and it never shows on Find help.
