function getTeacherCourseIds(db, teacherId) {
  const rows = db.prepare('SELECT course_id FROM teacher_courses WHERE user_id=?').all(teacherId);
  const ids = rows.map(r => r.course_id).filter(Boolean);
  if (ids.length) return ids;
  const fallback = db.prepare('SELECT course_id FROM users WHERE id=?').get(teacherId)?.course_id;
  return fallback ? [fallback] : [];
}

module.exports = { getTeacherCourseIds };
