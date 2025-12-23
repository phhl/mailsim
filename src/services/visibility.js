// Visibility logic (addressbook + recipients lists)

function getVisibleUsers(db, meId, meRole) {
  // Students/Teachers: same course + any teacher/admin
  // Admin: everyone (except self)
  const me = db.prepare(`
    SELECT u.id, u.role, u.course_id
    FROM users u
    WHERE u.id=?
  `).get(meId);

  if (!me) return [];

  if (meRole === 'admin') {
    return db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, c.name AS course_name
      FROM users u LEFT JOIN courses c ON c.id=u.course_id
      WHERE u.id != ?
        AND (u.expires_at IS NULL OR date(u.expires_at) >= date('now'))
      ORDER BY c.name, u.role, u.display_name
    `).all(meId);
  }

  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, c.name AS course_name
    FROM users u LEFT JOIN courses c ON c.id=u.course_id
    WHERE u.id != ?
      AND (u.expires_at IS NULL OR date(u.expires_at) >= date('now'))
      AND (
        (u.course_id IS NOT NULL AND u.course_id = ?)
        OR u.role IN ('teacher','admin')
      )
    ORDER BY c.name, u.role, u.display_name
  `).all(meId, me.course_id);
}

module.exports = { getVisibleUsers };
