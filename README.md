# PinDrop website starter

A responsive, multi-page front-end starter for PinDrop, a graphic design community.

## Pages
- `index.html` — home feed, sample designs, categories, search, likes, follow interactions
- `create.html` — separate design creation page with image upload, preview, title, description, category, tags, and publish flow
- `explore.html` — explore landing page
- `battles.html` — design battle concept page
- `tournaments.html` — tournament list concept page
- `profile.html` — profile starter page
- `styles.css` — shared white-and-blue responsive styling
- `app.js` — shared navigation and prototype interactions
- `create.js` — upload preview, validation, and local publish handling

## Run it
You can open `index.html` directly in a modern browser. For a local development server, open a terminal in this folder and run:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Important limitations
This is a front-end prototype, not a production social network yet.
- New posts are stored in this browser's local storage and are not shared with other users or devices.
- Sample likes and follows are demo interactions and are not synchronized.
- Authentication, database persistence, image hosting, comments, notifications, anti-spam protection, and official competition voting are not connected.
- For production, connect a backend such as Supabase (Auth, Postgres, and Storage), implement server-side validation and authorization, and deploy the site to a web host.

## Brand
- Product name: PinDrop
- Logo: white lowercase `p` in a blue circle
- Main blue: `#246BFD`
- Main background: white / soft gray
