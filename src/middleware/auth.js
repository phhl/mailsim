function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.redirect('/login');
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) return res.redirect('/login');
    if (!roles.includes(req.session.role)) {
      const title = req.t ? req.t('errors.title') : 'Forbidden';
      const message = req.t ? req.t('errors.not_allowed') : 'Forbidden';
      return res.status(403).render('error', {
        title,
        message,
        backUrl: req.get('referer') || '/'
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
