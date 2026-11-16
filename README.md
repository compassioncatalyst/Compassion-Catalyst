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
| `/dashboard` | Organization dashboard. Organizations land here after logging in |
| `/account` | Shows where a request stands before it's approved |
| `/join` | Page for teammates invited from the dashboard |
| `/admin` | Admin review. Only accounts marked admin in Supabase can use it |

## Files

- `config.js`: the Supabase address, the **publishable** key, and the Hope Harbor sample email. Never put a secret key in any file here.
- `connect.js`: talks to Supabase.
- `screens.js` + `app.js`: the public pages.
- `dash-screens.js` + `dash-app.js`: the organization dashboard.
- `account.js`, `admin.js`, `join.js`: the account, admin and join pages.
- `data.js`: a saved copy of the directory, used only if Supabase can't be reached. It also holds the made-up Hope Harbor sample.
- `_redirects`: short addresses such as `/organizations`.

## Who can see what

The database enforces every rule below with Row Level Security, so nobody gets around them by changing website files.

- Admin page: only accounts with `is_admin = true`. Add or remove admins on the Admin page under "Admin team".
- Dashboard: only members of an approved organization, and only for their own organization.
- Phone, email, website and address changes wait for an admin's approval before they go live.
- Hope Harbor: log in with the sample email in `config.js` to see the sample dashboard. Nothing in it is saved, and it never shows on Find help.
