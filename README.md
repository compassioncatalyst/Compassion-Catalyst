# Compassion Catalyst website

Plain HTML, CSS and JavaScript. No build step. Cloudflare publishes whatever is in this repository.

| File | What it is |
|---|---|
| index.html, directory.html, about.html, for-organizations.html, claim.html, login.html, signup.html | Public pages |
| account.html + account.js | "Your account": organizations see their requests and edit their listing |
| admin.html + admin.js | Admin review: approve listings, claims, contact changes, reports, and the Verified badge |
| config.js | Supabase project URL and **publishable** key (never put a secret key here) |
| connect.js | Talks to Supabase |
| supabase.js | Supabase's own library (v2.117.3), kept here so the site doesn't depend on another website |
| app.js, screens.js, styles.css | The public pages' code, layout and styles |
| data.js | Saved copy of the directory, used only if Supabase can't be reached |
| co-map.html | The map (uses Leaflet and OpenStreetMap) |
| track.html, dashboard.html | Old addresses that now forward to the right page |
