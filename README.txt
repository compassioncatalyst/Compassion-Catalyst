Co-mission Catalyst website — plain HTML, CSS and JavaScript

PAGES (each one is its own file)
  index.html       Home page
  directory.html   Find help (search, list and map)
  track.html       Track a referral
  about.html       About + contact form
  login.html       Organization sign in
  signup.html      Organization sign up
  dashboard.html   Organization dashboard (cases, messages, tasks, projects…)

OTHER FILES
  styles.css   Colors, fonts and shared styles
  app.js       Everything the site does (buttons, forms, screens)
  screens.js   The layout and wording of every screen
  data.js      SAMPLE data (organizations, cases, people) — replace before going public
  co-map.html  The map shown on the Find help page
  images/      The home page photo

THINGS TO REPLACE — search for "[YOUR"
  every .html file  → [YOUR TEXT HERE — one sentence describing your site…]  (search-engine description)
  app.js (PART 3)   → BRAND_NAME, your site name, shown across the site
  screens.js        → [YOUR PRIVACY POLICY LINK HERE], [YOUR TERMS OF USE LINK HERE], [YOUR FOOTER TEXT HERE…]
  data.js           → all sample organizations, people, cases and messages

SUPABASE — search app.js for "CONNECT TO SUPABASE HERE"
  Every form that should save something (sign in, sign up, applications,
  messages, tasks, projects, posts and so on) is marked. Right now they only
  change what's on screen, and everything resets when the page reloads.
  No passwords, secret keys or API keys are included.

LOADED FROM OTHER WEBSITES
  Google Fonts: "Barlow" and "Barlow Condensed" (fonts.googleapis.com, from styles.css and co-map.html)
  Leaflet 1.9.4 map library (unpkg.com, only in co-map.html)
  Icons are drawn inside app.js, and the photo is in images/, so nothing else is downloaded.
