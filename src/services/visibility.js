// Visibility logic (addressbook + recipients lists)

const { getTeacherCourseIds } = require('./teacherCourses');

function getVisibleUsers(db, meId, meRole) {
  const me = db.prepare(`
    SELECT u.id, u.role, u.course_id, u.school_id
    FROM users u
    WHERE u.id=?
  `).get(meId);

  if (!me) return [];

  if (meRole === 'admin') {
    return db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role,
             c.name AS course_name,
             COALESCE(sc.domain, us.domain) AS school_domain,
             COALESCE(sc.name, us.name) AS school_name,
             (
               SELECT GROUP_CONCAT(c2.name, ', ')
               FROM teacher_courses tc2
               JOIN courses c2 ON c2.id=tc2.course_id
               WHERE tc2.user_id=u.id
             ) AS teacher_courses
      FROM users u
      LEFT JOIN courses c ON c.id=u.course_id
      LEFT JOIN schools sc ON sc.id=c.school_id
      LEFT JOIN schools us ON us.id=u.school_id
      WHERE u.id != ?
        AND (u.expires_at IS NULL OR date(u.expires_at) >= date('now'))
        AND u.role IN ('schooladmin','teacher')
      ORDER BY
        school_name,
        CASE u.role WHEN 'schooladmin' THEN 0 ELSE 1 END,
        u.display_name
    `).all(meId);
  }

  if (meRole === 'schooladmin') {
    return db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, c.name AS course_name,
             COALESCE(sc.domain, us.domain) AS school_domain,
             COALESCE(sc.name, us.name) AS school_name,
             (
               SELECT GROUP_CONCAT(c2.name, ', ')
               FROM teacher_courses tc2
               JOIN courses c2 ON c2.id=tc2.course_id
               WHERE tc2.user_id=u.id
             ) AS teacher_courses
      FROM users u
      LEFT JOIN courses c ON c.id=u.course_id
      LEFT JOIN schools sc ON sc.id=c.school_id
      LEFT JOIN schools us ON us.id=u.school_id
      WHERE u.id != ?
        AND (u.expires_at IS NULL OR date(u.expires_at) >= date('now'))
        AND (
          u.role = 'admin'
          OR (
            u.role = 'teacher'
            AND (
              u.school_id = ?
              OR EXISTS (
                SELECT 1
                FROM teacher_courses tcx
                JOIN courses cx ON cx.id=tcx.course_id
                WHERE tcx.user_id=u.id AND cx.school_id=?
              )
            )
          )
          OR (u.role = 'student' AND c.school_id = ?)
        )
      ORDER BY
        CASE u.role WHEN 'admin' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END,
        c.name,
        u.display_name
    `).all(meId, me.school_id, me.school_id, me.school_id);
  }

  if (meRole === 'teacher') {
    const ids = getTeacherCourseIds(db, meId);
    const placeholders = ids.length ? ids.map(() => '?').join(',') : '?';
    const params = ids.length ? ids : [-1];
    return db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role,
             c.name AS course_name,
             COALESCE(sc.domain, us.domain) AS school_domain,
             COALESCE(sc.name, us.name) AS school_name,
             (
               SELECT GROUP_CONCAT(c2.name, ', ')
               FROM teacher_courses tc2
               JOIN courses c2 ON c2.id=tc2.course_id
               WHERE tc2.user_id=u.id
             ) AS teacher_courses
      FROM users u
      LEFT JOIN courses c ON c.id=u.course_id
      LEFT JOIN schools sc ON sc.id=c.school_id
      LEFT JOIN schools us ON us.id=u.school_id
      WHERE u.id != ?
        AND (u.expires_at IS NULL OR date(u.expires_at) >= date('now'))
        AND (
          (u.role = 'schooladmin' AND u.school_id = ?)
          OR (u.role = 'teacher' AND u.school_id = ?)
          OR (u.role = 'student' AND u.course_id IS NOT NULL AND u.course_id IN (${placeholders}))
        )
      ORDER BY
        CASE u.role WHEN 'schooladmin' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END,
        c.name,
        u.display_name
    `).all(meId, me.school_id, me.school_id, ...params);
  }

  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role,
           c.name AS course_name,
           COALESCE(sc.domain, us.domain) AS school_domain,
           COALESCE(sc.name, us.name) AS school_name,
           (
             SELECT GROUP_CONCAT(c2.name, ', ')
             FROM teacher_courses tc2
             JOIN courses c2 ON c2.id=tc2.course_id
             WHERE tc2.user_id=u.id
           ) AS teacher_courses
    FROM users u
    LEFT JOIN courses c ON c.id=u.course_id
    LEFT JOIN schools sc ON sc.id=c.school_id
    LEFT JOIN schools us ON us.id=u.school_id
    WHERE u.id != ?
      AND (u.expires_at IS NULL OR date(u.expires_at) >= date('now'))
      AND (
        (u.role = 'teacher' AND EXISTS (
          SELECT 1 FROM teacher_courses tc
          WHERE tc.user_id=u.id AND tc.course_id=?
        ))
        OR (u.role = 'student' AND u.course_id IS NOT NULL AND u.course_id = ?)
      )
    ORDER BY
      CASE u.role WHEN 'teacher' THEN 0 ELSE 1 END,
      u.display_name
  `).all(meId, me.course_id, me.course_id);
}

module.exports = { getVisibleUsers };
