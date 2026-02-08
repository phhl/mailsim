const express = require("express");
const multer = require("multer");

const { requireAuth } = require("../middleware/auth");
const { formatEmail, formatLogin } = require("../lib/address");
const { sendOrDraft, updateDraftOrSend } = require("../services/mail");
const {
  AttachmentError,
  getAttachmentConfig,
  saveAttachments,
  listAttachmentsForMessage,
  getAttachmentById,
  getAttachmentPath,
} = require("../services/attachments");
const { toBerlinLocal } = require("../utils/time");
const { getVisibleUsers } = require("../services/visibility");
const {
  isSendWindowOpen,
  isAttachmentsEnabled,
} = require("../services/sendWindow");
const { getTeacherCourseIds } = require("../services/teacherCourses");
const { parseIdList } = require("../utils/parse");

module.exports = function createMailRouter({ db }) {
  const router = express.Router();
  const allowedFolders = new Set(["INBOX", "SENT", "DRAFTS", "TRASH"]);
  const teacherCanSeeBcc = () =>
    (process.env.TEACHER_CAN_SEE_BCC || "0") === "1";
  const { maxBytes: maxAttachmentBytes, maxFiles: maxAttachmentFiles } =
    getAttachmentConfig();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxAttachmentBytes, files: maxAttachmentFiles },
  });
  const listTeacherCourses = (user) => {
    const raw = (user.teacher_courses || "").toString();
    const items = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length) return items;
    return user.course_name ? [user.course_name] : [];
  };

  const getUserAddress = (user) => {
    if (user.role === "admin") return "admin@admin";
    return formatLogin(
      {
        username: user.username,
        courseName: user.course_name,
        domain: user.school_domain,
        role: user.role,
      },
      process.env,
    );
  };

  const buildUserLabel = (user) => {
    const email = getUserAddress(user);
    return `${user.display_name} <${email}>`;
  };

  const mapComposeUsers = (users, t) =>
    users.map((u) => {
      return {
        id: u.id,
        role: u.role,
        label: buildUserLabel(u),
        course_name: u.course_name || "",
        school_domain: u.school_domain || "",
        teacher_courses: (u.teacher_courses || "").toString(),
      };
    });

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
  }

  function mapAttachmentList(list) {
    return (list || []).map((att) => ({
      ...att,
      size_label: formatBytes(att.size_bytes),
    }));
  }

  function attachmentsAllowedForUser(role, courseId) {
    if (role !== "student") return true;
    return isSendWindowOpen(db, courseId) && isAttachmentsEnabled(db, courseId);
  }

  function renderComposeWithError(
    req,
    res,
    { preset, returnFolder, error, status = 400, existingAttachments = [] },
  ) {
    const meId = req.session.userId;
    const users = getVisibleUsers(db, meId, req.session.role);
    return res.status(status).render("compose", {
      users: mapComposeUsers(users, req.t),
      preset,
      returnFolder,
      existingAttachments,
      error,
    });
  }

  router.get("/", requireAuth, (req, res) => res.redirect("/mailbox/INBOX"));

  router.get("/mailbox/:folder", requireAuth, (req, res) => {
    req.session.mailViewContext = "mailbox";
    const folder = (req.params.folder || "INBOX").toUpperCase();
    if (!allowedFolders.has(folder))
      return res.status(400).send(req.t("errors.bad_folder"));
    const folderLabels = {
      INBOX: req.t("sidebar.inbox"),
      SENT: req.t("sidebar.sent"),
      DRAFTS: req.t("sidebar.drafts"),
      TRASH: req.t("sidebar.trash"),
    };
    const folderLabel = folderLabels[folder] || folder;

    const items = db
      .prepare(
        `
      SELECT d.id AS delivery_id, d.folder, d.is_read, d.created_at,
             m.id AS message_id, m.subject, m.body_text,
             su.username AS sender_username, su.display_name AS sender_name, su.role AS sender_role,
             sc.name AS sender_course, ss.domain AS sender_domain, us.domain AS sender_user_domain
      FROM deliveries d
      JOIN messages m ON m.id=d.message_id
      JOIN users su ON su.id=m.sender_id
      LEFT JOIN courses sc ON sc.id=su.course_id
      LEFT JOIN schools ss ON ss.id=sc.school_id
      LEFT JOIN schools us ON us.id=su.school_id
      WHERE d.owner_user_id=? AND d.folder=? AND d.deleted_at IS NULL
      ORDER BY d.created_at DESC
      LIMIT 200
    `,
      )
      .all(req.session.userId, folder);

    const mapped = items.map((it) => ({
      ...it,
      created_at_local: toBerlinLocal(it.created_at),
      sender_email: formatLogin(
        {
          username: it.sender_username,
          courseName: it.sender_course,
          domain: it.sender_domain || it.sender_user_domain,
          role: it.sender_role,
        },
        process.env,
      ),
      snippet: (it.body_text || "").slice(0, 120),
    }));

    return res.render("mailbox", { folder, folderLabel, items: mapped });
  });

  function recipientsForMessage(
    messageId,
    viewerRole,
    viewerIsSender,
    viewerCanSeeBcc = false,
  ) {
    const rows = db
      .prepare(
        `
      SELECT r.type, u.username, u.display_name, u.role AS user_role,
             c.name AS course_name, s.domain AS school_domain, us.domain AS user_domain, u.id AS user_id
      FROM recipients r
      JOIN users u ON u.id=r.user_id
      LEFT JOIN courses c ON c.id=u.course_id
      LEFT JOIN schools s ON s.id=c.school_id
      LEFT JOIN schools us ON us.id=u.school_id
      WHERE r.message_id=?
      ORDER BY CASE r.type WHEN 'TO' THEN 1 WHEN 'CC' THEN 2 ELSE 3 END, u.display_name
    `,
      )
      .all(messageId);

    return rows
      .filter((r) => {
        if (viewerRole === "admin") return true;
        if (r.type !== "BCC") return true;
        // Normal mail behavior: BCC is hidden for recipients.
        // The sender may see their own BCC list; teachers/admin may see it for supervision.
        if (viewerRole === "student") return viewerIsSender;
        return viewerIsSender || viewerCanSeeBcc;
      })
      .map((r) => ({
        type: r.type,
        user_id: r.user_id,
        display_name: r.display_name,
        email: formatLogin(
          {
            username: r.username,
            courseName: r.course_name,
            domain: r.school_domain || r.user_domain,
            role: r.user_role,
          },
          process.env,
        ),
      }));
  }

  // Backward-compatible redirect (older links)
  router.get("/message/:messageId", requireAuth, (req, res) => {
    return res.redirect(
      302,
      `/mail/${encodeURIComponent(req.params.messageId)}`,
    );
  });

  // Unified mail view for admin/teacher/student with role-based authorization
  router.get("/mail/:messageId", requireAuth, (req, res) => {
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(messageId))
      return res.status(400).send(req.t("errors.bad_id"));
    const requestedFolderRaw = String(req.query.folder || "");
    const requestedFolder = requestedFolderRaw.toUpperCase();
    const preferredFolder = allowedFolders.has(requestedFolder)
      ? requestedFolder
      : null;

    // Kontext steuert, ob die Mailbox-Sidebar angezeigt wird.
    // mailbox (Default): Sidebar sichtbar
    // admin/teacher: Sidebar ausgeblendet (Detailansicht aus Verwaltungsseiten)
    const referer = String(req.get("referer") || "");
    let context = String(req.query.context || "");
    if (!context) {
      if (/\/teacher\b/i.test(referer)) context = "teacher";
      else if (/\/admin\b/i.test(referer)) context = "admin";
      else if (/\/mailbox\//i.test(referer)) context = "mailbox";
      else if (req.session.mailViewContext)
        context = String(req.session.mailViewContext);
      else context = "mailbox";
    }
    if (!["mailbox", "teacher", "admin"].includes(context)) context = "mailbox";
    req.session.mailViewContext = context;
    const showSidebar = context === "mailbox";
    const role = req.session.role;
    const meId = req.session.userId;

    const msg = db
      .prepare(
        `
      SELECT m.*,
             su.username AS sender_username,
             su.display_name AS sender_name,
             su.role AS sender_role,
             sc.name AS sender_course,
             ss.domain AS sender_domain,
             us.domain AS sender_user_domain
      FROM messages m
      JOIN users su ON su.id=m.sender_id
      LEFT JOIN courses sc ON sc.id=su.course_id
      LEFT JOIN schools ss ON ss.id=sc.school_id
      LEFT JOIN schools us ON us.id=su.school_id
      WHERE m.id=?
    `,
      )
      .get(messageId);

    if (!msg) return renderNotFound(req, res);

    // Access control
    // - admin: any message
    // - student: only messages they have a delivery for (inbox, sent, drafts, etc.)
    // - teacher: delivery messages, plus course-wide visibility of student sent mails in their own course
    let delivery = null;
    let courseWideTeacherView = false;
    if (role !== "admin") {
      if (preferredFolder) {
        delivery = db
          .prepare(
            "SELECT * FROM deliveries WHERE message_id=? AND owner_user_id=? AND folder=? AND deleted_at IS NULL",
          )
          .get(messageId, meId, preferredFolder);
      }
      if (!delivery) {
        delivery = db
          .prepare(
            "SELECT * FROM deliveries WHERE message_id=? AND owner_user_id=? AND deleted_at IS NULL",
          )
          .get(messageId, meId);
      }

      if (!delivery && role === "teacher") {
        const sender = db
          .prepare("SELECT course_id, role FROM users WHERE id=?")
          .get(msg.sender_id);
        const courseIds = getTeacherCourseIds(db, meId);
        if (
          sender?.course_id &&
          sender?.role === "student" &&
          courseIds.includes(sender.course_id)
        ) {
          courseWideTeacherView = true;
          delivery = { folder: "COURSE" };
        }
      }

      if (!delivery && role === "schooladmin") {
        const meSchool = db
          .prepare("SELECT school_id FROM users WHERE id=?")
          .get(meId)?.school_id;
        const sender = db
          .prepare("SELECT course_id, role FROM users WHERE id=?")
          .get(msg.sender_id);
        const senderSchool = sender?.course_id
          ? db
              .prepare("SELECT school_id FROM courses WHERE id=?")
              .get(sender.course_id)?.school_id
          : null;
        if (
          meSchool &&
          senderSchool &&
          senderSchool === meSchool &&
          sender?.role === "student"
        ) {
          courseWideTeacherView = true;
          delivery = { folder: "COURSE" };
        }
      }

      if (!delivery) return renderNotFound(req, res);
    } else {
      delivery = db
        .prepare("SELECT * FROM deliveries WHERE message_id=? LIMIT 1")
        .get(messageId) || { folder: "INBOX" };
    }

    const isDraftView = delivery?.folder === "DRAFTS" || msg.is_draft === 1;
    const viewerIsSender = msg.sender_id === meId;
    // Teachers and admins can see BCC; students can see BCC only on messages they sent.
    const canSeeBcc =
      role === "admin" ||
      role === "schooladmin" ||
      (role === "teacher" && teacherCanSeeBcc());
    const recips = recipientsForMessage(
      messageId,
      role,
      viewerIsSender,
      canSeeBcc,
    );
    const canReplyAll = !isDraftView && recips.length > 1;
    const canMoveToTrash =
      showSidebar &&
      delivery?.folder !== "TRASH" &&
      preferredFolder !== "TRASH" &&
      delivery?.folder !== "COURSE";
    const canRestoreFromTrash =
      showSidebar &&
      (delivery?.folder === "TRASH" || preferredFolder === "TRASH");
    let restoreTarget = null;
    if (canRestoreFromTrash) {
      if (msg.sender_id === meId) {
        restoreTarget = msg.is_draft === 1 ? "DRAFTS" : "SENT";
      } else {
        restoreTarget = "INBOX";
      }
    }
    const recipientsByType = { to: [], cc: [], bcc: [] };
    for (const r of recips) {
      const label = r.display_name ? `${r.display_name} <${r.email}>` : r.email;
      if (r.type === "TO") recipientsByType.to.push(label);
      if (r.type === "CC") recipientsByType.cc.push(label);
      if (r.type === "BCC") recipientsByType.bcc.push(label);
    }

    const attachments = mapAttachmentList(
      listAttachmentsForMessage(db, messageId),
    );

    // mark read if this is a real delivery for the viewer (avoid side effects for course-wide teacher views)
    if (!courseWideTeacherView) {
      db.prepare(
        "UPDATE deliveries SET is_read=1 WHERE message_id=? AND owner_user_id=?",
      ).run(messageId, meId);
    }

    // Sidebar highlighting: use the viewer's delivery folder; virtual course view maps to SENT.
    const activeFolder = showSidebar
      ? preferredFolder ||
        (delivery.folder === "COURSE" ? "SENT" : delivery.folder)
      : null;

    return res.render("message", {
      folder: delivery.folder,
      requestedFolder: preferredFolder,
      activeFolder,
      showSidebar,
      isDraftView,
      canReplyAll,
      canMoveToTrash,
      canRestoreFromTrash,
      restoreTarget,
      me: res.locals.me,
      mail: {
        ...msg,
        created_at_local: toBerlinLocal(msg.created_at),
        sender_email: formatLogin(
          {
            username: msg.sender_username,
            courseName: msg.sender_course,
            domain: msg.sender_domain || msg.sender_user_domain,
            role: msg.sender_role,
          },
          process.env,
        ),
        sender_display_name: msg.sender_name,
      },
      attachments,
      recipients: recipientsByType,
    });
  });

  router.post("/mail/:messageId/mark-unread", requireAuth, (req, res) => {
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(messageId))
      return res.status(400).send(req.t("errors.bad_id"));
    const meId = req.session.userId;
    const updated = db
      .prepare(
        "UPDATE deliveries SET is_read=0 WHERE message_id=? AND owner_user_id=? AND deleted_at IS NULL",
      )
      .run(messageId, meId);
    if (!updated.changes) return renderNotFound(req, res);

    const requestedFolderRaw = String(req.query.folder || "");
    const requestedFolder = requestedFolderRaw.toUpperCase();
    const preferredFolder = allowedFolders.has(requestedFolder)
      ? requestedFolder
      : null;
    if (preferredFolder) return res.redirect(`/mailbox/${preferredFolder}`);
    return res.redirect(`/mail/${encodeURIComponent(messageId)}`);
  });

  router.post("/mail/:messageId/trash", requireAuth, (req, res) => {
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(messageId))
      return res.status(400).send(req.t("errors.bad_id"));
    const meId = req.session.userId;
    const updated = db
      .prepare(
        "UPDATE deliveries SET folder='TRASH' WHERE message_id=? AND owner_user_id=? AND deleted_at IS NULL",
      )
      .run(messageId, meId);
    if (!updated.changes) return renderNotFound(req, res);
    return res.redirect("/mailbox/TRASH");
  });

  router.post("/mail/:messageId/restore", requireAuth, (req, res) => {
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(messageId))
      return res.status(400).send(req.t("errors.bad_id"));
    const meId = req.session.userId;
    const msg = db
      .prepare("SELECT id, sender_id, is_draft FROM messages WHERE id=?")
      .get(messageId);
    if (!msg) return renderNotFound(req, res);

    const targetFolder =
      msg.sender_id === meId
        ? msg.is_draft === 1
          ? "DRAFTS"
          : "SENT"
        : "INBOX";
    const updated = db
      .prepare(
        "UPDATE deliveries SET folder=? WHERE message_id=? AND owner_user_id=? AND deleted_at IS NULL",
      )
      .run(targetFolder, messageId, meId);
    if (!updated.changes) return renderNotFound(req, res);
    return res.redirect(`/mailbox/${targetFolder}`);
  });

  router.get("/compose", requireAuth, (req, res) => {
    const meId = req.session.userId;
    const users = getVisibleUsers(db, meId, req.session.role);
    const requestedFolderRaw = String(req.query.folder || "");
    const requestedFolder = requestedFolderRaw.toUpperCase();
    const preferredFolder = allowedFolders.has(requestedFolder)
      ? requestedFolder
      : null;

    const draftId = Number(req.query.draftId);
    let draftPreset = null;
    if (Number.isFinite(draftId) && draftId > 0) {
      const draft = db
        .prepare(
          `
        SELECT m.id, m.subject, m.body_html
        FROM messages m
        JOIN deliveries d ON d.message_id=m.id
        WHERE m.id=? AND m.sender_id=? AND m.is_draft=1
          AND d.owner_user_id=? AND d.folder='DRAFTS' AND d.deleted_at IS NULL
      `,
        )
        .get(draftId, meId, meId);
      if (!draft) return renderNotFound(req, res);

      const recRows = db
        .prepare("SELECT user_id, type FROM recipients WHERE message_id=?")
        .all(draftId);
      const to = recRows.filter((r) => r.type === "TO").map((r) => r.user_id);
      const cc = recRows.filter((r) => r.type === "CC").map((r) => r.user_id);
      const bcc = recRows.filter((r) => r.type === "BCC").map((r) => r.user_id);
      draftPreset = {
        subject: draft.subject || "",
        body_html: draft.body_html || "",
        to,
        cc,
        bcc,
        draft_id: draftId,
      };
    }
    const returnFolder = draftPreset ? "DRAFTS" : preferredFolder || "INBOX";
    const existingAttachments = draftPreset
      ? mapAttachmentList(listAttachmentsForMessage(db, draftId))
      : [];

    return res.render("compose", {
      users: mapComposeUsers(users, req.t),
      preset: {
        subject: draftPreset ? draftPreset.subject : req.query.subject || "",
        body_html: draftPreset ? draftPreset.body_html : req.query.body || "",
        to: draftPreset ? draftPreset.to : parseIdList(req.query.to),
        cc: draftPreset ? draftPreset.cc : parseIdList(req.query.cc),
        bcc: draftPreset ? draftPreset.bcc : parseIdList(req.query.bcc),
        draft_id: draftPreset ? draftPreset.draft_id : null,
        return_folder: returnFolder,
      },
      returnFolder,
      existingAttachments,
      error: null,
    });
  });

  router.post(
    "/compose",
    requireAuth,
    (req, res, next) => {
      upload.array("attachments", maxAttachmentFiles)(req, res, (err) => {
        if (!err) return next();

        const draftId = Number(req.body.draft_id);
        const hasDraftId = Number.isFinite(draftId) && draftId > 0;
        const requestedFolderRaw = String(req.body.return_folder || "");
        const requestedFolder = requestedFolderRaw.toUpperCase();
        const returnFolder = allowedFolders.has(requestedFolder)
          ? requestedFolder
          : "INBOX";
        const to = parseIdList(req.body.to_ids);
        const cc = parseIdList(req.body.cc_ids);
        const bcc = parseIdList(req.body.bcc_ids);
        const existingAttachments = hasDraftId
          ? mapAttachmentList(listAttachmentsForMessage(db, draftId))
          : [];

        let message = req.t("compose.attachments_upload_error");
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE")
            message = req.t("compose.attachments_too_large");
          if (err.code === "LIMIT_FILE_COUNT")
            message = req.t("compose.attachments_too_many");
        }
        return renderComposeWithError(req, res, {
          preset: {
            subject: req.body.subject || "",
            body_html: req.body.body_html || "",
            to,
            cc,
            bcc,
            draft_id: hasDraftId ? draftId : null,
            return_folder: returnFolder,
          },
          returnFolder,
          existingAttachments,
          error: message,
          status: 400,
        });
      });
    },
    (req, res) => {
      const meId = req.session.userId;
      const draftId = Number(req.body.draft_id);
      const hasDraftId = Number.isFinite(draftId) && draftId > 0;
      const requestedFolderRaw = String(req.body.return_folder || "");
      const requestedFolder = requestedFolderRaw.toUpperCase();
      const returnFolder = allowedFolders.has(requestedFolder)
        ? requestedFolder
        : "INBOX";

      // Empf?nger werden client-seitig als kommaseparierte ID-Liste geliefert.
      // Wir verwenden bewusst *_ids als Feldnamen, um nicht mit "to/cc/bcc" UI-Inputs zu kollidieren.
      const to = parseIdList(req.body.to_ids);
      const cc = parseIdList(req.body.cc_ids);
      const bcc = parseIdList(req.body.bcc_ids);

      const action = req.body.action === "draft" ? "draft" : "send";
      const meCourseId = res.locals.me?.course_id || null;
      const attachmentsAllowed = attachmentsAllowedForUser(
        req.session.role,
        meCourseId,
      );
      const incomingFiles = Array.isArray(req.files) ? req.files : [];
      const existingAttachments = hasDraftId
        ? mapAttachmentList(listAttachmentsForMessage(db, draftId))
        : [];

      // Versandfenster: Sch?ler d?rfen nur senden, wenn Lehrkraft freigeschaltet hat
      if (req.session.role === "student" && action === "send") {
        if (!isSendWindowOpen(db, meCourseId)) {
          return renderComposeWithError(req, res, {
            preset: {
              subject: req.body.subject || "",
              body_html: req.body.body_html || "",
              to,
              cc,
              bcc: [],
              draft_id: hasDraftId ? draftId : null,
              return_folder: returnFolder,
            },
            returnFolder,
            existingAttachments,
            error: req.t("compose.send_locked_notice"),
            status: 403,
          });
        }
      }

      if (req.session.role === "student" && !attachmentsAllowed) {
        if (
          incomingFiles.length ||
          (action === "send" && existingAttachments.length)
        ) {
          return renderComposeWithError(req, res, {
            preset: {
              subject: req.body.subject || "",
              body_html: req.body.body_html || "",
              to,
              cc,
              bcc,
              draft_id: hasDraftId ? draftId : null,
              return_folder: returnFolder,
            },
            returnFolder,
            existingAttachments,
            error: req.t("compose.attachments_disabled_notice"),
            status: 403,
          });
        }
      }

      const payload = {
        to,
        cc,
        bcc,
        subject: req.body.subject || "",
        body_html: req.body.body_html || "",
        action,
      };

      let result = null;
      try {
        result = hasDraftId
          ? updateDraftOrSend(
              db,
              { id: meId, role: req.session.role },
              payload,
              draftId,
            )
          : sendOrDraft(db, { id: meId, role: req.session.role }, payload);

        if (incomingFiles.length) {
          saveAttachments(db, result.messageId, incomingFiles);
        }

        if (result.isDraft) return res.redirect("/mailbox/DRAFTS");
        return res.redirect("/mailbox/SENT");
      } catch (e) {
        if (result && !result.isDraft && incomingFiles.length) {
          try {
            db.prepare("DELETE FROM messages WHERE id=?").run(result.messageId);
          } catch (_) {}
        }
        let message = e.message || req.t("errors.generic");
        if (e instanceof AttachmentError) {
          if (e.code === "size")
            message = req.t("compose.attachments_too_large");
          if (e.code === "type")
            message = req.t("compose.attachments_invalid_type");
        }
        return renderComposeWithError(req, res, {
          preset: {
            subject: req.body.subject || "",
            body_html: req.body.body_html || "",
            to,
            cc,
            bcc,
            draft_id: hasDraftId ? draftId : null,
            return_folder: returnFolder,
          },
          returnFolder,
          existingAttachments,
          error: message,
          status: 400,
        });
      }
    },
  );

  router.get("/attachments/:attachmentId", requireAuth, (req, res) => {
    const attachmentId = Number(req.params.attachmentId);
    if (!Number.isFinite(attachmentId))
      return res.status(400).send(req.t("errors.bad_id"));

    const attachment = getAttachmentById(db, attachmentId);
    if (!attachment) return renderNotFound(req, res);

    const meId = req.session.userId;
    const role = req.session.role;
    if (!canAccessMessage(attachment.message_id, meId, role)) {
      return renderNotFound(req, res);
    }

    const downloadName = String(
      attachment.original_name || "attachment",
    ).replace(/[\r\n"]/g, "_");
    const filePath = getAttachmentPath(attachment.storage_name);
    res.setHeader("Content-Type", attachment.mime_type);
    return res.download(filePath, downloadName, (err) => {
      if (err && !res.headersSent) {
        renderNotFound(req, res);
      }
    });
  });

  // Reply / Reply‑All / Forward (mit korrekter Empfängerlogik)
  function getMessageForAction(messageId) {
    return db
      .prepare(
        `
      SELECT m.*, su.id AS sender_id, su.display_name AS sender_name, su.username AS sender_username, sc.name AS sender_course, ss.domain AS sender_domain
      FROM messages m
      JOIN users su ON su.id=m.sender_id
      LEFT JOIN courses sc ON sc.id=su.course_id
      LEFT JOIN schools ss ON ss.id=sc.school_id
      WHERE m.id=?
    `,
      )
      .get(messageId);
  }

  function canAccessMessage(messageId, meId, meRole) {
    if (meRole === "admin") return true;
    const hasDelivery = !!db
      .prepare(
        "SELECT 1 FROM deliveries WHERE message_id=? AND owner_user_id=? AND deleted_at IS NULL",
      )
      .get(messageId, meId);
    if (hasDelivery) return true;

    if (meRole === "teacher" || meRole === "schooladmin") {
      const senderId = db
        .prepare("SELECT sender_id FROM messages WHERE id=?")
        .get(messageId)?.sender_id;
      if (!senderId) return false;
      const sender = db
        .prepare("SELECT course_id, role FROM users WHERE id=?")
        .get(senderId);
      if (!sender || sender.role !== "student") return false;

      if (meRole === "teacher") {
        const courseIds = getTeacherCourseIds(db, meId);
        return sender.course_id && courseIds.includes(sender.course_id);
      }

      if (meRole === "schooladmin") {
        const meSchool = db
          .prepare("SELECT school_id FROM users WHERE id=?")
          .get(meId)?.school_id;
        const senderSchool = sender.course_id
          ? db
              .prepare("SELECT school_id FROM courses WHERE id=?")
              .get(sender.course_id)?.school_id
          : null;
        return !!meSchool && !!senderSchool && meSchool === senderSchool;
      }
    }

    return false;
  }

  function buildQuotedHtml(msg, quoteLine) {
    return `<blockquote>
      <p><strong>${quoteLine}</strong></p>
      ${msg.body_html}
    </blockquote>`;
  }

  router.get("/reply/:messageId", requireAuth, (req, res) => {
    const messageId = Number(req.params.messageId);
    const meId = req.session.userId;
    const role = req.session.role;

    if (!canAccessMessage(messageId, meId, role))
      return renderNotFound(req, res);

    const msg = getMessageForAction(messageId);
    if (!msg) return renderNotFound(req, res);

    const replyPrefix = req.t("mail.reply_prefix");
    const subjectRaw = msg.subject || "";
    const subject = subjectRaw
      .toLowerCase()
      .startsWith(replyPrefix.toLowerCase())
      ? subjectRaw
      : `${replyPrefix} ${subjectRaw}`;
    const quoteLine = req.t("mail.quote_line", {
      date: msg.created_at,
      name: msg.sender_name,
    });
    const body = `<p></p>${buildQuotedHtml(msg, quoteLine)}`;

    const params = new URLSearchParams({
      subject,
      body,
      to: String(msg.sender_id),
    });
    return res.redirect("/compose?" + params.toString());
  });

  router.get("/reply-all/:messageId", requireAuth, (req, res) => {
    const messageId = Number(req.params.messageId);
    const meId = req.session.userId;
    const role = req.session.role;

    if (!canAccessMessage(messageId, meId, role))
      return renderNotFound(req, res);

    const msg = getMessageForAction(messageId);
    if (!msg) return renderNotFound(req, res);

    // Reply-All: TO = original sender (if not me) + original TO/CC (no BCC), excluding me.
    const rec = db
      .prepare(
        `
      SELECT r.type, r.user_id
      FROM recipients r
      WHERE r.message_id=? AND r.type IN ('TO','CC')
    `,
      )
      .all(messageId);

    const toSet = new Set();
    const ccSet = new Set();

    if (msg.sender_id !== meId) toSet.add(msg.sender_id);

    for (const r of rec) {
      if (r.user_id === meId) continue;
      if (r.type === "TO") toSet.add(r.user_id);
      if (r.type === "CC") ccSet.add(r.user_id);
    }

    // De-dup CC vs TO
    for (const id of toSet) ccSet.delete(id);

    const replyPrefix = req.t("mail.reply_prefix");
    const subjectRaw = msg.subject || "";
    const subject = subjectRaw
      .toLowerCase()
      .startsWith(replyPrefix.toLowerCase())
      ? subjectRaw
      : `${replyPrefix} ${subjectRaw}`;
    const quoteLine = req.t("mail.quote_line", {
      date: msg.created_at,
      name: msg.sender_name,
    });
    const body = `<p></p>${buildQuotedHtml(msg, quoteLine)}`;

    const params = new URLSearchParams({
      subject,
      body,
      to: Array.from(toSet).join(","),
      cc: Array.from(ccSet).join(","),
    });
    return res.redirect("/compose?" + params.toString());
  });

  router.get("/forward/:messageId", requireAuth, (req, res) => {
    const messageId = Number(req.params.messageId);
    const meId = req.session.userId;
    const role = req.session.role;

    if (!canAccessMessage(messageId, meId, role))
      return renderNotFound(req, res);

    const msg = getMessageForAction(messageId);
    if (!msg) return renderNotFound(req, res);

    const forwardPrefix = req.t("mail.forward_prefix");
    const subjectRaw = msg.subject || "";
    const subject = subjectRaw
      .toLowerCase()
      .startsWith(forwardPrefix.toLowerCase())
      ? subjectRaw
      : `${forwardPrefix} ${subjectRaw}`;
    const quoteLine = req.t("mail.quote_line", {
      date: msg.created_at,
      name: msg.sender_name,
    });
    const body = `<p></p>${buildQuotedHtml(msg, quoteLine)}`;

    const params = new URLSearchParams({ subject, body });
    return res.redirect("/compose?" + params.toString());
  });

  // Resolve an entered email/label to a user id (for manual entry)
  router.get("/resolve", requireAuth, (req, res) => {
    const meId = req.session.userId;
    const term = (req.query.term || "").toString().trim();
    if (!term) return res.json({ ok: false });

    const m = term.match(/<([^>]+)>/);
    const email = (m ? m[1] : term).trim().toLowerCase();

    const visible = getVisibleUsers(db, meId, req.session.role);
    for (const u of visible) {
      const addr = getUserAddress(u).toLowerCase();
      if (addr === email || u.username.toLowerCase() === email) {
        return res.json({ ok: true, id: u.id, label: buildUserLabel(u) });
      }
    }
    return res.json({ ok: false });
  });

  router.get("/userlabel", requireAuth, (req, res) => {
    const meId = req.session.userId;
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) return res.json({ ok: false });

    const visible = getVisibleUsers(db, meId, req.session.role);
    const u = visible.find((x) => x.id === id);
    if (!u) return res.json({ ok: false });

    return res.json({ ok: true, id: u.id, label: buildUserLabel(u) });
  });

  // ---------- Addressbook (Ajax autocomplete) ----------
  router.get("/addressbook", requireAuth, (req, res) => {
    const meId = req.session.userId;
    const q = (req.query.q || "").toString().toLowerCase();
    const rows = getVisibleUsers(db, meId, req.session.role)
      .filter((u) => {
        if (!q) return true;
        const courseName = (u.course_name || "").toLowerCase();
        const teacherCourses = (u.teacher_courses || "").toLowerCase();
        const display = (u.display_name || "").toLowerCase();
        const username = (u.username || "").toLowerCase();
        return (
          courseName.includes(q) ||
          teacherCourses.includes(q) ||
          display.includes(q) ||
          username.includes(q)
        );
      })
      .slice(0, 20);

    return res.json(
      rows.map((u) => ({
        id: u.id,
        label: buildUserLabel(u),
      })),
    );
  });

  return router;
};
const renderNotFound = (req, res) => {
  return res.status(404).render("error", {
    title: req.t("errors.not_found"),
    message: req.t("errors.not_found"),
    backUrl: req.get("referer") || "/mailbox/INBOX",
  });
};
