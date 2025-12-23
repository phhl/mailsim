function formatEmail({ username, courseName }, env) {
  const template = (env.MAIL_DOMAIN_TEMPLATE || '{course}.' + (env.MAIL_DOMAIN || 'local.test')).trim();
  const course = (courseName && courseName.trim()) ? courseName.trim() : 'default';
  const domain = (env.MAIL_DOMAIN || 'local.test').trim();
  const rendered = template
    .replaceAll('{course}', course)
    .replaceAll('{domain}', domain);
  return `${username}@${rendered}`;
}

module.exports = { formatEmail };
