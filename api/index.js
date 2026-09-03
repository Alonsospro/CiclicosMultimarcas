const app = require('../server');

module.exports = (req, res) => {
  try {
    return app(req, res);
  } catch (err) {
    console.error('[Vercel Serverless Invocation Error]', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'FUNCTION_INVOCATION_ERROR',
        message: err.message || String(err)
      }));
    }
  }
};
