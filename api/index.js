// Vercel serverless entry point.
// Vercel exposes files under /api/ as serverless functions. We simply hand the
// request to the same Express app used locally / on the VPS. All routing
// (/api/* + static + SPA fallback) is handled inside db-server.js.
module.exports = require('../db-server.js');
