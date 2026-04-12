# Valkey Proxy Server Code Map

- [Entry Index](./entry-index.md)
- [Key Folder Index](./key-folder-index.md)

Start from `index.js` for runtime bootstrap, then move into `app.js` for request handlers and Redis helper logic.
Use `test-connection.js` when you need to inspect the live connectivity probe, and `README.md` when you need operator-facing validation guidance.
