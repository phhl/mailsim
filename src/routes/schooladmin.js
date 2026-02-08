const express = require('express');
const bcrypt = require('bcryptjs');

const { requireRole } = require('../middleware/auth');
const { deleteAttachmentFiles, collectStorageNamesByUserIds } = require('../services/attachments');
const { cleanupCourse } = require('../services/cleanup');
const { formatLogin } = require('../lib/address');
const { fetchLogs } = require('../services/logs');
const { parseOptionalId } = require('../utils/parse');

module.exports = function createSchoolAdminRouter({ db }) {
  const router = express.Router();

  router.get('/schooladmin', requireRole('schooladmin','admin'), (req, res) => {
    const meId = req.session.userId;
    const role = req.session.role;

    const me = db.prepare(`
      SELECT u.id, u.display_name, u.role, u.school_id, s.name AS school_name, s.domain AS school_domain
      FROM users u
      LEFT JOIN schools s ON s.id=u.school_id
      WHERE u.id=?
    `).get(meId);

    const schools = role === 'admin'
      ? db.prepare('SELECT id, name, domain FROM schools ORDER BY name').all()
      : [];

    const hasSchoolQuery = Object.prototype.hasOwnProperty.call(req.query, 'school_id');
    const requestedSchoolId = role === 'admin'
      ? parseOptionalId(req.query.school_id)
      : null;
    if (role === 'admin' && hasSchoolQuery) {
      req.session.schooladminSelectedSchoolId = Number.isFinite(requestedSchoolId)
        ? requestedSchoolId
        : null;
    }
    const selectedSchoolId = role === 'admin'
      ? (Number.isFinite(requestedSchoolId)
        ? requestedSchoolId
        : parseOptionalId(req.session.schooladminSelectedSchoolId))
      : (me?.school_id || null);

    const school = Number.isFinite(selectedSchoolId)
      ? db.prepare('SELECT id, name, domain FROM schools WHERE id=?').get(selectedSchoolId)
      : null;

    const courses = Number.isFinite(selectedSchoolId)
      ? db.prepare(`
          SELECT c.id, c.name,
            (SELECT COUNT(*) FROM users u WHERE u.course_id=c.id) AS student_count,
            (SELECT COUNT(*) FROM teacher_courses tc WHERE tc.course_id=c.id) AS teacher_count,
            (SELECT COUNT(*) FROM messages m JOIN users u ON u.id=m.sender_id WHERE u.course_id=c.id) AS message_count
          FROM courses c
          WHERE c.school_id=?
          ORDER BY c.name
        `).all(selectedSchoolId)
      : [];

    const teachersRaw = Number.isFinite(selectedSchoolId)
      ? db.prepare(`
          SELECT u.id, u.username, u.display_name,
                 GROUP_CONCAT(c.name, ', ') AS course_names
          FROM users u
          LEFT JOIN teacher_courses tc ON tc.user_id=u.id
          LEFT JOIN courses c ON c.id=tc.course_id
          WHERE u.role='teacher' AND c.school_id=?
          GROUP BY u.id, u.username, u.display_name
          ORDER BY u.display_name
        `).all(selectedSchoolId)
      : [];
    const teachers = teachersRaw.map((tchr) => ({
      ...tchr,
      login: formatLogin({ username: tchr.username, domain: school?.domain, role: 'teacher' }, process.env)
    }));

    const teacherCourseRows = Number.isFinite(selectedSchoolId)
      ? db.prepare(`
          SELECT tc.user_id, tc.course_id
          FROM teacher_courses tc
          JOIN courses c ON c.id=tc.course_id
          WHERE c.school_id=?
        `).all(selectedSchoolId)
      : [];

    const teacherCourses = new Map();
    for (const row of teacherCourseRows) {
      if (!teacherCourses.has(row.user_id)) teacherCourses.set(row.user_id, []);
      teacherCourses.get(row.user_id).push(row.course_id);
    }

    const logSizeRaw = Number(req.query.log_page_size || req.session.schooladminLogPageSize || 20);
    const logPageSizes = [10, 20, 50, 100];
    const logPageSize = logPageSizes.includes(logSizeRaw) ? logSizeRaw : 20;
    req.session.schooladminLogPageSize = logPageSize;
    const logPageRaw = Number(req.query.log_page || 1);
    let logPage = Number.isFinite(logPageRaw) && logPageRaw > 0 ? Math.floor(logPageRaw) : 1;

    let totalLogs = 0;
    let totalPages = 1;
    let logs = [];
    if (Number.isFinite(selectedSchoolId)) {
      totalLogs = db.prepare(`
        SELECT COUNT(*) AS count
        FROM mail_logs l
        JOIN users su ON su.id=l.sender_id
        LEFT JOIN courses sc ON sc.id=su.course_id
        WHERE sc.school_id=?
      `).get(selectedSchoolId)?.count || 0;
      totalPages = Math.max(1, Math.ceil(totalLogs / logPageSize));
      if (logPage > totalPages) logPage = totalPages;
      const logOffset = (logPage - 1) * logPageSize;
      logs = fetchLogs(db, { scope: 'school', schoolId: selectedSchoolId, limit: logPageSize, offset: logOffset });
    }

    const result = req.session.schooladminResult || null;
    if (req.session.schooladminResult) delete req.session.schooladminResult;

    if (req.query.logs_only === '1') {
      const logsPagination = {
        page: logPage,
        totalPages,
        totalLogs,
        pageSize: logPageSize,
        pageSizes: logPageSizes
      };
      const logsQuery = (role === 'admin' && selectedSchoolId)
        ? { school_id: selectedSchoolId }
        : {};
      return res.render('partials/logs_table', {
        logs,
        logsPagination,
        basePath: '/schooladmin',
        logsQuery,
        emptyMessage: req.t('common.no_entries')
      });
    }

    return res.render('schooladmin', {
      me,
      role,
      school,
      schools,
      courses,
      teachers,
      teacherCourses,
      selectedSchoolId,
      result,
      logs,
      logsPagination: {
        page: logPage,
        totalPages,
        totalLogs,
        pageSize: logPageSize,
        pageSizes: logPageSizes
      }
    });
  });

  router.post('/schooladmin/courses/create', requireRole('schooladmin','admin'), (req, res) => {
    const meId = req.session.userId;
    const role = req.session.role;
    const name = (req.body.name || '').toString().trim();

    let schoolId = null;
    if (role === 'admin') {
      schoolId = parseOptionalId(req.body.school_id);
    } else {
      schoolId = db.prepare('SELECT school_id FROM users WHERE id=?').get(meId)?.school_id || null;
    }

    if (!name) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.course_name_missing') };
      return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
    }
    if (!Number.isFinite(schoolId)) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.school_missing') };
      return res.redirect('/schooladmin');
    }

    const existingCourse = db.prepare('SELECT id FROM courses WHERE school_id=? AND name=?').get(schoolId, name);
    if (existingCourse) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.course_exists') };
      return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
    }

    try {
      db.prepare('INSERT INTO courses(name, school_id) VALUES (?, ?)').run(name, schoolId);
      req.session.schooladminResult = { ok: true, message: req.t('schooladmin.course_created') };
    } catch (e) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.course_exists_or_school_missing') };
    }

    return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
  });

  router.post('/schooladmin/courses/update', requireRole('schooladmin','admin'), (req, res) => {
    const meId = req.session.userId;
    const role = req.session.role;
    const courseId = Number(req.body.course_id || 0);
    const name = (req.body.name || '').toString().trim();
    let schoolId = null;

    if (role === 'admin') {
      schoolId = parseOptionalId(req.body.school_id);
    } else {
      schoolId = db.prepare('SELECT school_id FROM users WHERE id=?').get(meId)?.school_id || null;
    }

    if (!Number.isFinite(courseId) || !name || !Number.isFinite(schoolId)) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.course_data_missing') };
      return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
    }

    const course = db.prepare('SELECT id FROM courses WHERE id=? AND school_id=?').get(courseId, schoolId);
    if (!course) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.course_not_found') };
      return res.redirect('/schooladmin');
    }

    try {
      db.prepare('UPDATE courses SET name=? WHERE id=?').run(name, courseId);
      req.session.schooladminResult = { ok: true, message: req.t('schooladmin.course_updated') };
    } catch (e) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.update_failed') };
    }

    return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
  });

  router.post('/schooladmin/courses/delete', requireRole('schooladmin','admin'), (req, res) => {
    const meId = req.session.userId;
    const role = req.session.role;
    const courseId = Number(req.body.course_id || 0);
    const confirmName = (req.body.confirm_name || '').toString().trim();

    let schoolId = null;
    if (role === 'admin') {
      schoolId = parseOptionalId(req.body.school_id);
    } else {
      schoolId = db.prepare('SELECT school_id FROM users WHERE id=?').get(meId)?.school_id || null;
    }

    const course = Number.isFinite(courseId) && Number.isFinite(schoolId)
      ? db.prepare('SELECT id, name FROM courses WHERE id=? AND school_id=?').get(courseId, schoolId)
      : null;

    if (!course) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.course_not_found') };
      return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
    }

    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users u WHERE u.course_id=c.id) AS student_count,
        (SELECT COUNT(*) FROM teacher_courses tc WHERE tc.course_id=c.id) AS teacher_count,
        (SELECT COUNT(*) FROM messages m JOIN users u ON u.id=m.sender_id WHERE u.course_id=c.id) AS message_count
      FROM courses c WHERE c.id=?
    `).get(courseId) || {};

    const needsConfirm = (stats.student_count || 0) || (stats.teacher_count || 0) || (stats.message_count || 0);
    if (needsConfirm && confirmName !== course.name) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.confirm_name_mismatch') };
      return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
    }

    const { attachmentNames } = cleanupCourse(db, courseId);
    if (attachmentNames.length) deleteAttachmentFiles(attachmentNames);
    req.session.schooladminResult = { ok: true, message: req.t('schooladmin.course_deleted') };
    return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
  });

  router.post('/schooladmin/teachers/create', requireRole('schooladmin','admin'), (req, res) => {
    const meId = req.session.userId;
    const role = req.session.role;
    const username = (req.body.username || '').toString().trim();
    const displayName = (req.body.display_name || '').toString().trim();
    const password = (req.body.password || '').toString().trim();
    const courseIds = [].concat(req.body.course_ids || []).map(Number).filter(Number.isFinite);

    let schoolId = null;
    if (role === 'admin') {
      schoolId = parseOptionalId(req.body.school_id);
    } else {
      schoolId = db.prepare('SELECT school_id FROM users WHERE id=?').get(meId)?.school_id || null;
    }

    if (!username || !displayName || !password) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.all_fields_required') };
      return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
    }
    if (!Number.isFinite(schoolId)) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.school_missing') };
      return res.redirect('/schooladmin');
    }

    const allowedCourses = new Set(
      db.prepare('SELECT id FROM courses WHERE school_id=?').all(schoolId).map(r => r.id)
    );
    const filteredCourseIds = courseIds.filter(id => allowedCourses.has(id));

    if (!filteredCourseIds.length) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.at_least_one_course') };
      return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
    }

    const existingTeacher = db.prepare(`
      SELECT u.id
      FROM users u
      LEFT JOIN teacher_courses tc ON tc.user_id=u.id
      LEFT JOIN courses c ON c.id=tc.course_id
      WHERE u.role='teacher'
        AND lower(u.username)=lower(?)
        AND (u.school_id=? OR c.school_id=?)
      LIMIT 1
    `).get(username, schoolId, schoolId);

    if (existingTeacher) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.username_exists_school') };
      return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
    }

    try {
      const hash = bcrypt.hashSync(password, 12);
      const tx = db.transaction(() => {
        const result = db.prepare('INSERT INTO users(username, display_name, role, school_id, pw_hash) VALUES (?,?,?,?,?)')
          .run(username, displayName, 'teacher', schoolId, hash);
        const teacherId = result.lastInsertRowid;
        const ins = db.prepare('INSERT INTO teacher_courses(user_id, course_id) VALUES (?, ?)');
        for (const id of filteredCourseIds) ins.run(teacherId, id);
      });
      tx();
      req.session.schooladminResult = { ok: true, message: req.t('schooladmin.teacher_created') };
    } catch (e) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.teacher_exists') };
    }

    return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
  });

  router.post('/schooladmin/teachers/update', requireRole('schooladmin','admin'), (req, res) => {
    const meId = req.session.userId;
    const role = req.session.role;
    const teacherId = Number(req.body.teacher_id || 0);
    const displayName = (req.body.display_name || '').toString().trim();
    const newPassword = (req.body.password || '').toString().trim();
    const courseIdsRaw = [].concat(req.body.course_ids || []);
    const courseIds = courseIdsRaw.map(Number).filter(Number.isFinite);

    let schoolId = null;
    if (role === 'admin') {
      schoolId = parseOptionalId(req.body.school_id);
    } else {
      schoolId = db.prepare('SELECT school_id FROM users WHERE id=?').get(meId)?.school_id || null;
    }

    if (!Number.isFinite(teacherId) || !Number.isFinite(schoolId)) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.teacher_data_missing') };
      return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
    }

    const teacher = db.prepare(`
      SELECT u.id, u.display_name
      FROM users u
      WHERE u.id=? AND u.role='teacher'
    `).get(teacherId);

    if (!teacher) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.teacher_not_found') };
      return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
    }

    const allowedCourses = new Set(
      db.prepare('SELECT id FROM courses WHERE school_id=?').all(schoolId).map(r => r.id)
    );
    const filteredCourseIds = courseIds.filter(id => allowedCourses.has(id));

    const tx = db.transaction(() => {
      const nextDisplayName = displayName || teacher.display_name;
      if (displayName || newPassword) {
        if (newPassword) {
          const hash = bcrypt.hashSync(newPassword, 12);
          db.prepare("UPDATE users SET display_name=?, pw_hash=? WHERE id=? AND role='teacher'")
            .run(nextDisplayName, hash, teacherId);
        } else {
          db.prepare("UPDATE users SET display_name=? WHERE id=? AND role='teacher'")
            .run(nextDisplayName, teacherId);
        }
      }

      if (courseIdsRaw.length) {
        if (!filteredCourseIds.length) {
          throw new Error(req.t('schooladmin.at_least_one_course'));
        }

        const existing = db.prepare(`
          SELECT tc.course_id
          FROM teacher_courses tc
          JOIN courses c ON c.id=tc.course_id
          WHERE tc.user_id=? AND c.school_id=?
        `).all(teacherId, schoolId).map(r => r.course_id);

        const del = db.prepare('DELETE FROM teacher_courses WHERE user_id=? AND course_id=?');
        for (const id of existing) {
          if (!filteredCourseIds.includes(id)) del.run(teacherId, id);
        }

        const ins = db.prepare('INSERT OR IGNORE INTO teacher_courses(user_id, course_id) VALUES (?, ?)');
        for (const id of filteredCourseIds) ins.run(teacherId, id);
      }
    });
    try {
      tx();
      req.session.schooladminResult = { ok: true, message: req.t('schooladmin.teacher_updated') };
    } catch (e) {
      req.session.schooladminResult = { ok: false, error: e.message || req.t('schooladmin.update_failed') };
    }
    return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
  });

  router.post('/schooladmin/teachers/delete', requireRole('schooladmin','admin'), (req, res) => {
    const meId = req.session.userId;
    const role = req.session.role;
    const teacherId = Number(req.body.teacher_id || 0);

    let schoolId = null;
    if (role === 'admin') {
      schoolId = parseOptionalId(req.body.school_id);
    } else {
      schoolId = db.prepare('SELECT school_id FROM users WHERE id=?').get(meId)?.school_id || null;
    }

    if (!Number.isFinite(teacherId)) {
      req.session.schooladminResult = { ok: false, error: req.t('schooladmin.teacher_missing') };
      return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
    }

    const attachmentNames = collectStorageNamesByUserIds(db, [teacherId]);
    db.prepare("DELETE FROM users WHERE id=? AND role='teacher'").run(teacherId);
    deleteAttachmentFiles(attachmentNames);
    req.session.schooladminResult = { ok: true, message: req.t('schooladmin.teacher_deleted') };
    return res.redirect('/schooladmin' + (Number.isFinite(schoolId) ? `?school_id=${schoolId}` : ''));
  });

  return router;
};
