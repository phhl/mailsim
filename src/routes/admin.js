const express = require('express');
const bcrypt = require('bcryptjs');

const { requireRole } = require('../middleware/auth');
const { collectStorageNamesByUserIds, deleteAttachmentFiles } = require('../services/attachments');
const { cleanupSchool } = require('../services/cleanup');
const { formatLogin } = require('../lib/address');
const { fetchLogs } = require('../services/logs');

module.exports = function createAdminRouter({ db }) {
  const router = express.Router();

  function getSchoolStats(schoolId) {
    const courseCount = db.prepare('SELECT COUNT(*) AS count FROM courses WHERE school_id=?').get(schoolId)?.count || 0;
    const studentCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM users u
      JOIN courses c ON c.id=u.course_id
      WHERE c.school_id=?
    `).get(schoolId)?.count || 0;
    const teacherCount = db.prepare(`
      SELECT COUNT(DISTINCT u.id) AS count
      FROM users u
      JOIN teacher_courses tc ON tc.user_id=u.id
      JOIN courses c ON c.id=tc.course_id
      WHERE c.school_id=?
    `).get(schoolId)?.count || 0;
    const schoolAdminCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM users u
      WHERE u.role='schooladmin' AND u.school_id=?
    `).get(schoolId)?.count || 0;
    const messageCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM messages m
      JOIN users u ON u.id=m.sender_id
      JOIN courses c ON c.id=u.course_id
      WHERE c.school_id=?
    `).get(schoolId)?.count || 0;

    return { courseCount, studentCount, teacherCount, schoolAdminCount, messageCount };
  }

  router.get('/admin/routes', requireRole('admin'), (req, res) => {
    return res.json({
      routes: [
        'GET /admin',
        'POST /admin/schools/create',
        'POST /admin/schools/update',
        'POST /admin/schools/delete',
        'POST /admin/schooladmins/create',
        'POST /admin/schooladmins/update',
        'POST /admin/schooladmins/password',
        'POST /admin/schooladmins/delete',
        'POST /admin/cleanup-expired',
        'GET /teacher',
        'POST /teacher/send-window/open',
        'POST /teacher/send-window/close',
        'POST /teacher/import-csv',
        'POST /teacher/generate-users',
        'GET /teacher/download-created.csv',
        'POST /teacher/delete-users',
        'GET /schooladmin',
        'POST /schooladmin/courses/create',
        'POST /schooladmin/courses/update',
        'POST /schooladmin/courses/delete',
        'POST /schooladmin/teachers/create',
        'POST /schooladmin/teachers/update',
        'POST /schooladmin/teachers/delete'
      ]
    });
  });

  router.get('/admin', requireRole('admin'), (req, res) => {
    req.session.mailViewContext = 'admin';
    const sizeRaw = Number(req.query.log_page_size || req.session.logPageSize || 20);
    const allowedSizes = [10, 20, 50, 100];
    const LOGS_PAGE_SIZE = allowedSizes.includes(sizeRaw) ? sizeRaw : 20;
    req.session.logPageSize = LOGS_PAGE_SIZE;
    const pageRaw = Number(req.query.log_page || 1);
    let logPage = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
    const totalLogs = db.prepare('SELECT COUNT(*) AS count FROM mail_logs').get()?.count || 0;
    const totalPages = Math.max(1, Math.ceil(totalLogs / LOGS_PAGE_SIZE));
    if (logPage > totalPages) logPage = totalPages;
    const logOffset = (logPage - 1) * LOGS_PAGE_SIZE;

    const schools = db.prepare(`
      SELECT s.id, s.name, s.domain,
        (SELECT COUNT(*) FROM courses c WHERE c.school_id=s.id) AS course_count,
        (SELECT COUNT(*) FROM users u JOIN courses c ON c.id=u.course_id WHERE c.school_id=s.id) AS student_count,
        (SELECT COUNT(DISTINCT u.id) FROM users u JOIN teacher_courses tc ON tc.user_id=u.id JOIN courses c ON c.id=tc.course_id WHERE c.school_id=s.id) AS teacher_count,
        (SELECT COUNT(*) FROM users u WHERE u.role='schooladmin' AND u.school_id=s.id) AS schooladmin_count,
        (SELECT COUNT(*) FROM messages m JOIN users u ON u.id=m.sender_id JOIN courses c ON c.id=u.course_id WHERE c.school_id=s.id) AS message_count
      FROM schools s
      ORDER BY s.name
    `).all();

    const schooladminsRaw = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.expires_at, u.school_id,
             s.name AS school_name, s.domain AS school_domain
      FROM users u
      LEFT JOIN schools s ON s.id=u.school_id
      WHERE u.role='schooladmin'
      ORDER BY s.name, u.display_name
    `).all();
    const schooladmins = schooladminsRaw.map((u) => ({
      ...u,
      login: formatLogin({ username: u.username, domain: u.school_domain, role: 'schooladmin' }, process.env)
    }));

    const logs = fetchLogs(db, { scope: 'admin', limit: LOGS_PAGE_SIZE, offset: logOffset });
    const expiredCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE expires_at IS NOT NULL AND date(expires_at) < date('now')").get()?.count || 0;

    const schoolResult = req.session.adminSchoolResult || null;
    if (req.session.adminSchoolResult) delete req.session.adminSchoolResult;
    const schoolAdminResult = req.session.adminSchoolAdminResult || null;
    if (req.session.adminSchoolAdminResult) delete req.session.adminSchoolAdminResult;
    const adminProfileResult = req.session.adminProfileResult || null;
    if (req.session.adminProfileResult) delete req.session.adminProfileResult;

    if (req.query.logs_only === '1') {
      return res.render('partials/logs_table', {
        logs,
        logsPagination: {
          page: logPage,
          totalPages,
          totalLogs,
          pageSize: LOGS_PAGE_SIZE,
          pageSizes: allowedSizes
        },
        basePath: '/admin',
        logsQuery: {},
        emptyMessage: req.t('common.no_entries')
      });
    }

    return res.render('admin', {
      schools,
      schooladmins,
      logs,
      expiredCount,
      schoolResult,
      schoolAdminResult,
      adminProfileResult,
      logsPagination: {
        page: logPage,
        totalPages,
        totalLogs,
        pageSize: LOGS_PAGE_SIZE,
        pageSizes: allowedSizes
      }
    });
  });

  router.post('/admin/profile', requireRole('admin'), (req, res) => {
    const displayName = (req.body.display_name || '').toString().trim();
    if (!displayName) {
      req.session.adminProfileResult = { ok: false, error: req.t('admin.display_name_required') };
      return res.redirect('/admin');
    }

    db.prepare("UPDATE users SET display_name=? WHERE id=? AND role='admin'")
      .run(displayName, req.session.userId);
    req.session.display_name = displayName;
    req.session.adminProfileResult = { ok: true };
    return res.redirect('/admin');
  });

  router.post('/admin/schools/create', requireRole('admin'), (req, res) => {
    const name = (req.body.name || '').toString().trim();
    const domain = (req.body.domain || '').toString().trim();
    if (!name || !domain) {
      req.session.adminSchoolResult = { ok: false, error: req.t('admin.name_domain_required') };
      return res.redirect('/admin');
    }

    try {
      db.prepare('INSERT INTO schools(name, domain) VALUES (?, ?)').run(name, domain);
      req.session.adminSchoolResult = { ok: true, name, domain };
    } catch (e) {
      req.session.adminSchoolResult = { ok: false, error: req.t('admin.school_exists_or_domain_taken') };
    }
    return res.redirect('/admin');
  });

  router.post('/admin/schools/update', requireRole('admin'), (req, res) => {
    const schoolId = Number(req.body.school_id || 0);
    const name = (req.body.name || '').toString().trim();
    const domain = (req.body.domain || '').toString().trim();
    if (!Number.isFinite(schoolId) || !name || !domain) {
      req.session.adminSchoolResult = { ok: false, error: req.t('admin.name_domain_required') };
      return res.redirect('/admin');
    }

    try {
      db.prepare('UPDATE schools SET name=?, domain=? WHERE id=?').run(name, domain, schoolId);
      req.session.adminSchoolResult = { ok: true, name, domain };
    } catch (e) {
      req.session.adminSchoolResult = { ok: false, error: req.t('admin.update_failed_name_domain') };
    }
    return res.redirect('/admin');
  });

  router.post('/admin/schools/delete', requireRole('admin'), (req, res) => {
    const schoolId = Number(req.body.school_id || 0);
    const confirmName = (req.body.confirm_name || '').toString().trim();
    const school = db.prepare('SELECT id, name FROM schools WHERE id=?').get(schoolId);
    if (!school) {
      req.session.adminSchoolResult = { ok: false, error: req.t('admin.school_not_found') };
      return res.redirect('/admin');
    }

    const stats = getSchoolStats(schoolId);
    const needsConfirm = stats.courseCount || stats.studentCount || stats.teacherCount || stats.schoolAdminCount || stats.messageCount;
    if (needsConfirm && confirmName !== school.name) {
      req.session.adminSchoolResult = { ok: false, error: req.t('admin.confirm_name_mismatch') };
      return res.redirect('/admin');
    }

    const { attachmentNames, userIds } = cleanupSchool(db, schoolId);
    if (attachmentNames.length) deleteAttachmentFiles(attachmentNames);
    req.session.adminSchoolResult = { ok: true, name: school.name, deleted: true };
    return res.redirect('/admin');
  });

  router.post('/admin/schooladmins/create', requireRole('admin'), (req, res) => {
    const username = (req.body.username || '').toString().trim();
    const displayName = (req.body.display_name || '').toString().trim();
    const schoolId = Number(req.body.school_id || 0);
    const password = (req.body.password || '').toString().trim();

    if (!username || !displayName || !password || !Number.isFinite(schoolId)) {
      req.session.adminSchoolAdminResult = { ok: false, error: req.t('admin.all_fields_required') };
      return res.redirect('/admin');
    }

    const existingAdmin = db.prepare(`
      SELECT id FROM users
      WHERE role='schooladmin' AND lower(username)=lower(?) AND school_id=?
    `).get(username, schoolId);

    if (existingAdmin) {
      req.session.adminSchoolAdminResult = { ok: false, error: req.t('admin.username_exists_school') };
      return res.redirect('/admin');
    }

    try {
      const hash = bcrypt.hashSync(password, 12);
      db.prepare('INSERT INTO users(username, display_name, role, school_id, pw_hash) VALUES (?,?,?,?,?)')
        .run(username, displayName, 'schooladmin', schoolId, hash);
      req.session.adminSchoolAdminResult = { ok: true };
    } catch (e) {
      req.session.adminSchoolAdminResult = { ok: false, error: req.t('admin.schooladmin_exists') };
    }
    return res.redirect('/admin');
  });

  router.post('/admin/schooladmins/update', requireRole('admin'), (req, res) => {
    const userId = Number(req.body.user_id || 0);
    const displayName = (req.body.display_name || '').toString().trim();
    const schoolId = Number(req.body.school_id || 0);
    if (!Number.isFinite(userId) || !displayName || !Number.isFinite(schoolId)) {
      req.session.adminSchoolAdminResult = { ok: false, error: req.t('admin.all_fields_required') };
      return res.redirect('/admin');
    }

    db.prepare("UPDATE users SET display_name=?, school_id=? WHERE id=? AND role='schooladmin'")
      .run(displayName, schoolId, userId);
    req.session.adminSchoolAdminResult = { ok: true };
    return res.redirect('/admin');
  });

  router.post('/admin/schooladmins/password', requireRole('admin'), (req, res) => {
    const userId = Number(req.body.user_id || 0);
    const password = (req.body.password || '').toString().trim();
    if (!Number.isFinite(userId) || !password) {
      req.session.adminSchoolAdminResult = { ok: false, error: req.t('admin.password_missing') };
      return res.redirect('/admin');
    }

    const hash = bcrypt.hashSync(password, 12);
    db.prepare("UPDATE users SET pw_hash=? WHERE id=? AND role='schooladmin'").run(hash, userId);
    req.session.adminSchoolAdminResult = { ok: true };
    return res.redirect('/admin');
  });

  router.post('/admin/schooladmins/delete', requireRole('admin'), (req, res) => {
    const userId = Number(req.body.user_id || 0);
    const confirmName = (req.body.confirm_name || '').toString().trim();
    if (!Number.isFinite(userId)) {
      req.session.adminSchoolAdminResult = { ok: false, error: req.t('admin.schooladmin_missing') };
      return res.redirect('/admin');
    }

    const target = db.prepare("SELECT id, display_name FROM users WHERE id=? AND role='schooladmin'").get(userId);
    if (!target) {
      req.session.adminSchoolAdminResult = { ok: false, error: req.t('admin.schooladmin_missing') };
      return res.redirect('/admin');
    }
    if (!confirmName || confirmName !== target.display_name) {
      req.session.adminSchoolAdminResult = { ok: false, error: req.t('admin.confirm_name_mismatch_schooladmin') };
      return res.redirect('/admin');
    }

    const attachmentNames = collectStorageNamesByUserIds(db, [userId]);
    db.prepare("DELETE FROM users WHERE id=? AND role='schooladmin'").run(userId);
    deleteAttachmentFiles(attachmentNames);
    req.session.adminSchoolAdminResult = { ok: true };
    return res.redirect('/admin');
  });

  router.post('/admin/cleanup-expired', requireRole('admin'), (req, res) => {
    const expiredIds = db.prepare(
      "SELECT id FROM users WHERE expires_at IS NOT NULL AND date(expires_at) < date('now')"
    ).all().map(r => r.id);
    const attachmentNames = collectStorageNamesByUserIds(db, expiredIds);
    db.prepare("DELETE FROM users WHERE expires_at IS NOT NULL AND date(expires_at) < date('now')").run();
    deleteAttachmentFiles(attachmentNames);
    return res.redirect('/admin');
  });

  return router;
};
