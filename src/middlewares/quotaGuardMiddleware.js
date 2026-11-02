// Near the daily quota, metrics keep answering from cached sources and counts are never blocked.
module.exports = function createHeavyReadLimiter(usage) {
  return function limitHeavyReads(req, res, next) {
    if (usage?.level() !== 'protect') return next();
    if (req.method === 'POST') {
      return res.status(429).json({
        success: false,
        code: 'FIRESTORE_QUOTA_PROTECTION',
        message: 'El recálculo está en pausa porque se alcanzó el 90% de la cuota diaria de Firestore. Se habilitará al renovarse la cuota; los conteos siguen funcionando.'
      });
    }
    delete req.query.refresh;
    delete req.query.recalculate;
    next();
  };
};
