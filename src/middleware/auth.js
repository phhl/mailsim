function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.redirect('/login');
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) return res.redirect('/login');
    if (!roles.includes(req.session.role)) return res.status(403).send('Forbidden');
    next();
  };
}

module.exports = { requireAuth, requireRole };
