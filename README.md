# Saturn / Plato

A Node.js website with:
- **Signup + login**
- A logged-in dashboard with only two tools:
  - **Plato** — movies page
  - **Saturn** — lightweight web proxy where the user types a URL

## Install

```bash
npm install
npm start
```

Then open:

```bash
http://localhost:3000
```

## Notes about Saturn

Saturn is the main focus in this build. It:
- fetches pages through your Express server
- rewrites common HTML links and assets
- rewrites forms so many normal GET/POST forms still work
- rewrites CSS `url(...)` and `@import`
- stores simple cookies per session

## Important limitations

This is a **lightweight educational proxy**, not a full browser engine. Some sites will still fail because of:
- heavy JavaScript apps
- CSP / anti-bot systems
- service workers
- WebSockets
- advanced login flows
- sites that aggressively block proxying or rewriting

## Production improvements

If you want to level it up later, add:
- a real database (SQLite, PostgreSQL, etc.)
- connect-redis or another session store
- CSRF protection
- rate limiting
- better cookie jar / per-origin storage
- JS/XHR/fetch rewriting
- WebSocket support
- admin controls and logs
