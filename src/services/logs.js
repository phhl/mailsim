const { formatLogin } = require('../lib/address');

function loadLogsBase(db, { scope, schoolId, limit, offset }) {
  if (scope === 'school') {
    return db.prepare(`
      SELECT l.id, l.created_at,
             su.display_name AS sender_name, su.username AS sender_username, su.role AS sender_role,
             sc.name AS sender_course, ss.domain AS sender_domain, us.domain AS sender_user_domain
      FROM mail_logs l
      JOIN users su ON su.id=l.sender_id
      LEFT JOIN courses sc ON sc.id=su.course_id
      LEFT JOIN schools ss ON ss.id=sc.school_id
      LEFT JOIN schools us ON us.id=su.school_id
      WHERE sc.school_id=?
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `).all(schoolId, limit, offset);
  }

  return db.prepare(`
    SELECT l.id, l.created_at,
           su.display_name AS sender_name, su.username AS sender_username, su.role AS sender_role,
           sc.name AS sender_course, ss.domain AS sender_domain, us.domain AS sender_user_domain
    FROM mail_logs l
    JOIN users su ON su.id=l.sender_id
    LEFT JOIN courses sc ON sc.id=su.course_id
    LEFT JOIN schools ss ON ss.id=sc.school_id
    LEFT JOIN schools us ON us.id=su.school_id
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

function loadRecipients(db, logIds) {
  if (!logIds.length) return [];
  const placeholders = logIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT r.log_id, r.type, u.display_name, u.username, u.role AS user_role,
           c.name AS course_name, s.domain AS school_domain, us.domain AS user_domain
    FROM mail_log_recipients r
    JOIN users u ON u.id=r.user_id
    LEFT JOIN courses c ON c.id=u.course_id
    LEFT JOIN schools s ON s.id=c.school_id
    LEFT JOIN schools us ON us.id=u.school_id
    WHERE r.log_id IN (${placeholders})
    ORDER BY r.log_id, r.type, u.display_name
  `).all(...logIds);
}

function fetchLogs(db, { scope = 'admin', schoolId, limit = 20, offset = 0 }) {
  const logs = loadLogsBase(db, { scope, schoolId, limit, offset });
  if (!logs.length) return [];

  const ids = logs.map(l => l.id);
  const recRows = loadRecipients(db, ids);
  const grouped = new Map();
  for (const row of recRows) {
    const key = row.log_id;
    if (!grouped.has(key)) grouped.set(key, { TO: [], CC: [], BCC: [] });
    const email = formatLogin(
      {
        username: row.username,
        courseName: row.course_name,
        domain: row.school_domain || row.user_domain,
        role: row.user_role
      },
      process.env
    );
    grouped.get(key)[row.type].push(`${row.display_name} <${email}>`);
  }

  return logs.map(l => ({
    ...l,
    sender_email: formatLogin(
      {
        username: l.sender_username,
        courseName: l.sender_course,
        domain: l.sender_domain || l.sender_user_domain,
        role: l.sender_role
      },
      process.env
    ),
    to: (grouped.get(l.id)?.TO || []).join(', '),
    cc: (grouped.get(l.id)?.CC || []).join(', '),
    bcc: (grouped.get(l.id)?.BCC || []).join(', ')
  }));
}

module.exports = { fetchLogs };
