const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const db = require("../config/db");
const fs = require("fs");
const path = require("path");

// ==================== HELPERS ====================

const sanitizeString = (str) => {
  if (!str) return str;
  return String(str)
    .trim()
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<[^>]*>/g, "");
};

const parseBoolean = (val, defaultVal = 0) => {
  if (val === undefined || val === null || val === "") return defaultVal;
  if (typeof val === "boolean") return val ? 1 : 0;
  if (val === "true" || val === "1" || val === 1) return 1;
  if (val === "false" || val === "0" || val === 0) return 0;
  return defaultVal;
};

const validateNotification = ({ title, message }, isUpdate = false) => {
  const errors = [];
  if (!isUpdate || title !== undefined) {
    if (!title || title.trim().length < 3) errors.push("Title must be at least 3 characters");
    else if (title.length > 255) errors.push("Title cannot exceed 255 characters");
  }
  if (!isUpdate || message !== undefined) {
    if (!message || message.trim().length < 5) errors.push("Message must be at least 5 characters");
    else if (message.length > 5000) errors.push("Message cannot exceed 5000 characters");
  }
  return errors;
};

const tsForFile = () => new Date().toISOString().replace(/[:.]/g, "-");

// ==================== BACKUP DIR SETUP ====================

const BACKUP_DIR = path.join(__dirname, "..", "backups");
try {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log("✅ Backups folder created:", BACKUP_DIR);
  } else {
    console.log("✅ Backups folder exists:", BACKUP_DIR);
  }
} catch (dirErr) {
  console.warn("⚠️ Could not create backups folder:", dirErr.message);
  console.warn("⚠️ Backups will still download but won't be saved on server");
}

// ==================== CLOUDINARY STORAGE ====================

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const originalName = file.originalname
      .split(".")[0]
      .replace(/[^a-zA-Z0-9]/g, "-")
      .toLowerCase()
      .slice(0, 50);

    const isDoc = file.mimetype === "application/pdf" || file.mimetype.includes("word");

    return {
      folder: "school/notifications",
      resource_type: isDoc ? "raw" : "image",
      allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx"],
      transformation: isDoc ? undefined : [{ quality: "auto" }, { fetch_format: "auto" }],
      public_id: `notification-${originalName}-${uniqueSuffix}`,
    };
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images, PDFs and Word documents are allowed!"), false);
  },
});

// Multer for JSON backup uploads (memory storage)
const jsonUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/json" || file.originalname.endsWith(".json")) cb(null, true);
    else cb(new Error("Only JSON backup files are allowed!"), false);
  },
});

// ==================== CLOUDINARY DELETE ====================

const deleteFromCloudinary = async (publicId, hint = "") => {
  if (!publicId) return;
  let resourceType = "image";
  const lower = (publicId + " " + hint).toLowerCase();
  if (lower.includes("pdf") || lower.includes("doc") || lower.includes("word")) {
    resourceType = "raw";
  }
  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
    console.log(`✅ Cloudinary delete [${resourceType}]:`, publicId, "→", result.result);
    return result;
  } catch (err) {
    console.error("❌ Cloudinary Delete Error:", err.message);
    try {
      const altType = resourceType === "image" ? "raw" : "image";
      await cloudinary.uploader.destroy(publicId, { resource_type: altType, invalidate: true });
    } catch (e2) {
      console.error("❌ Fallback failed:", e2.message);
    }
  }
};

// ═══════════════════════════════════════════════════════════
// 📊 STATS
// ═══════════════════════════════════════════════════════════

router.get("/admin/stats", (req, res) => {
  db.query(
    `SELECT 
       COUNT(*) as total,
       SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
       SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive,
       SUM(CASE WHEN file_url IS NOT NULL AND file_url != 'null' THEN 1 ELSE 0 END) as withFile
     FROM notifications`,
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      res.json({ success: true, data: result[0] });
    }
  );
});

// ═══════════════════════════════════════════════════════════
// 📦 BACKUP — DOWNLOAD JSON
// ═══════════════════════════════════════════════════════════

router.get("/admin/backup", (req, res) => {
  console.log("📦 Backup request received");

  db.query("SELECT * FROM notifications ORDER BY id ASC", (err, rows) => {
    if (err) {
      console.error("❌ Backup DB Error:", err);
      return res.status(500).json({
        success: false,
        message: "Backup failed — database error",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }

    console.log(`✅ Fetched ${rows.length} notifications for backup`);

    const backupData = {
      meta: {
        system: "Notification System",
        version: "1.0",
        generatedAt: new Date().toISOString(),
        generatedBy: req.user?.name || req.user?.email || "admin",
        totalRecords: rows.length,
      },
      notifications: rows,
    };

    const fileName = `notifications-backup-${tsForFile()}.json`;

    // Try to save server-side (don't fail if it doesn't work)
    try {
      const filePath = path.join(BACKUP_DIR, fileName);
      fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), "utf8");
      console.log(`✅ Backup saved on server: ${filePath}`);
    } catch (writeErr) {
      console.warn("⚠️ Could not save backup on server (continuing):", writeErr.message);
    }

    // Always send download
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(JSON.stringify(backupData, null, 2));
  });
});

// ═══════════════════════════════════════════════════════════
// 📦 BACKUP — LIST SAVED
// ═══════════════════════════════════════════════════════════

router.get("/admin/backup/list", (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("notifications-backup-") && f.endsWith(".json"))
      .map(f => {
        try {
          const stat = fs.statSync(path.join(BACKUP_DIR, f));
          return {
            fileName: f,
            size: stat.size,
            sizeKB: (stat.size / 1024).toFixed(2),
            createdAt: stat.birthtime || stat.mtime,
            downloadUrl: `/api/notifications/admin/backup/download/${f}`,
          };
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, count: files.length, data: files });
  } catch (err) {
    console.error("❌ Backup list error:", err);
    res.status(500).json({ success: false, message: "Failed to list backups", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 📦 BACKUP — DOWNLOAD SAVED FILE
// ═══════════════════════════════════════════════════════════

router.get("/admin/backup/download/:fileName", (req, res) => {
  const { fileName } = req.params;

  if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    return res.status(400).json({ success: false, message: "Invalid filename" });
  }

  const filePath = path.join(BACKUP_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "Backup file not found" });
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  fs.createReadStream(filePath).pipe(res);
});

// ═══════════════════════════════════════════════════════════
// 📦 BACKUP — DELETE SAVED FILE
// ═══════════════════════════════════════════════════════════

router.delete("/admin/backup/:fileName", (req, res) => {
  const { fileName } = req.params;

  if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    return res.status(400).json({ success: false, message: "Invalid filename" });
  }

  const filePath = path.join(BACKUP_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "Backup file not found" });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, message: "Backup deleted ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete backup", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 📥 RESTORE
// ═══════════════════════════════════════════════════════════

router.post("/admin/restore", jsonUpload.single("backup"), async (req, res) => {
  try {
    console.log("📥 Restore request received");
    let backupData;

    if (req.file) {
      const content = req.file.buffer.toString("utf8");
      backupData = JSON.parse(content);
      console.log(`✅ Backup file parsed: ${req.file.originalname}`);
    } else if (req.body?.backup) {
      backupData = typeof req.body.backup === "string" ? JSON.parse(req.body.backup) : req.body.backup;
    } else {
      return res.status(400).json({ success: false, message: "No backup data provided" });
    }

    const notifications = backupData.notifications || backupData.data || backupData;
    if (!Array.isArray(notifications) || !notifications.length) {
      return res.status(400).json({ success: false, message: "Invalid backup format — notifications array missing" });
    }

    const mode = req.body?.mode || "merge";
    console.log(`📥 Mode: ${mode}, Records: ${notifications.length}`);

    const results = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    const processRecord = (n) => {
      return new Promise((resolve) => {
        if (!n.title || !n.message) {
          results.skipped++;
          return resolve();
        }

        // Support both old and new schema fields
        const row = {
          id: n.id || null,
          title: sanitizeString(n.title),
          message: sanitizeString(n.message),
          file: n.file || n.file_url || null,
          file_public_id: n.file_public_id || null,
          type: n.type || n.attendance || "general",
          isImportant: parseBoolean(n.isImportant, 0),
          link: n.link || null,
          created_at: n.created_at ? new Date(n.created_at) : new Date(),
        };

        const doCheck = row.id
          ? new Promise((resolve, reject) => {
              db.query("SELECT id FROM notifications WHERE id = ?", [row.id], (e, r) => {
                if (e) reject(e);
                else resolve(r);
              });
            })
          : Promise.resolve([]);

        const insertWithId = (r) => {
          // Try full schema first, fallback to minimal if columns don't exist
          const insertFull = r.id
            ? `INSERT INTO notifications (id, title, message, file, file_public_id, type, isImportant, link, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            : `INSERT INTO notifications (title, message, file, file_public_id, type, isImportant, link, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

          const paramsFull = r.id
            ? [r.id, r.title, r.message, r.file, r.file_public_id, r.type, r.isImportant, r.link, r.created_at]
            : [r.title, r.message, r.file, r.file_public_id, r.type, r.isImportant, r.link, r.created_at];

          db.query(insertFull, paramsFull, (iErr) => {
            if (iErr) {
              // Fallback: minimal schema
              const insertMin = r.id
                ? `INSERT INTO notifications (id, title, message, file, created_at) VALUES (?, ?, ?, ?, ?)`
                : `INSERT INTO notifications (title, message, file, created_at) VALUES (?, ?, ?, ?)`;
              const paramsMin = r.id
                ? [r.id, r.title, r.message, r.file, r.created_at]
                : [r.title, r.message, r.file, r.created_at];

              db.query(insertMin, paramsMin, (iErr2) => {
                if (iErr2) {
                  results.errors.push({ id: r.id, error: iErr2.message });
                  results.skipped++;
                } else {
                  if (r.id) results.updated++; else results.inserted++;
                }
                resolve();
              });
            } else {
              if (r.id) results.updated++; else results.inserted++;
              resolve();
            }
          });
        };

        doCheck
          .then((existing) => {
            const exists = existing?.length > 0;

            if (exists && mode === "merge") {
              db.query(
                `UPDATE notifications 
                 SET title=?, message=?, file=?, file_public_id=?, type=?, isImportant=?, link=?, created_at=?
                 WHERE id=?`,
                [row.title, row.message, row.file, row.file_public_id, row.type,
                 row.isImportant, row.link, row.created_at, row.id],
                (uErr) => {
                  if (uErr) {
                    // Fallback minimal update
                    db.query(
                      `UPDATE notifications SET title=?, message=?, file=?, created_at=? WHERE id=?`,
                      [row.title, row.message, row.file, row.created_at, row.id],
                      (uErr2) => {
                        if (uErr2) {
                          results.errors.push({ id: row.id, error: uErr2.message });
                          results.skipped++;
                        } else results.updated++;
                        resolve();
                      }
                    );
                  } else {
                    results.updated++;
                    resolve();
                  }
                }
              );
            } else if (exists && mode === "replace") {
              db.query("DELETE FROM notifications WHERE id = ?", [row.id], (dErr) => {
                if (dErr) {
                  results.errors.push({ id: row.id, error: dErr.message });
                  results.skipped++;
                  return resolve();
                }
                insertWithId(row);
              });
            } else {
              insertWithId(row);
            }
          })
          .catch((err) => {
            results.errors.push({ id: row.id, error: err.message });
            results.skipped++;
            resolve();
          });
      });
    };

    for (const n of notifications) {
      await processRecord(n);
    }

    console.log(`✅ Restore complete:`, results);

    res.json({
      success: true,
      message: `Restore complete ✅ (${results.inserted} inserted, ${results.updated} updated, ${results.skipped} skipped)`,
      mode,
      results,
    });
  } catch (err) {
    console.error("❌ Restore Error:", err);
    res.status(500).json({ success: false, message: "Restore failed", error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 📊 REPORT — JSON / CSV
// ═══════════════════════════════════════════════════════════

router.get("/admin/report", (req, res) => {
  const { from, to, type, isImportant } = req.query;

  const whereClauses = [];
  const params = [];

  if (from) { whereClauses.push("created_at >= ?"); params.push(new Date(from)); }
  if (to) { whereClauses.push("created_at <= ?"); params.push(new Date(to)); }
  if (type) { whereClauses.push("type = ?"); params.push(type); }
  if (isImportant !== undefined) { whereClauses.push("isImportant = ?"); params.push(parseBoolean(isImportant)); }

  const whereSQL = whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : "";

  db.query(`SELECT * FROM notifications ${whereSQL} ORDER BY created_at DESC`, params, (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: "Report failed", error: err.message });

    const summary = {
      total: rows.length,
      important: rows.filter(r => r.isImportant).length,
      withFile: rows.filter(r => r.file).length,
      byType: {},
      byDate: {},
    };

    rows.forEach(r => {
      summary.byType[r.type || "general"] = (summary.byType[r.type || "general"] || 0) + 1;
      const d = r.created_at ? new Date(r.created_at).toISOString().split("T")[0] : "unknown";
      summary.byDate[d] = (summary.byDate[d] || 0) + 1;
    });

    if (req.query.format === "csv") {
      const headers = ["ID", "Title", "Message", "Type", "Important", "Link", "File", "Created At"];
      const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csvLines = [headers.join(",")];
      rows.forEach(r => {
        csvLines.push([
          r.id, r.title, r.message, r.type,
          r.isImportant ? "Yes" : "No",
          r.link || "", r.file || "",
          r.created_at ? new Date(r.created_at).toISOString() : "",
        ].map(escape).join(","));
      });

      const csv = "\uFEFF" + csvLines.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="notification-report-${tsForFile()}.csv"`);
      return res.send(csv);
    }

    res.json({
      success: true,
      data: {
        meta: {
          title: "Notification Report",
          generatedAt: new Date().toISOString(),
          filters: { from, to, type, isImportant },
          period: from || to ? `${from || "start"} to ${to || "now"}` : "All time",
        },
        summary,
        notifications: rows,
      },
    });
  });
});

// ═══════════════════════════════════════════════════════════
// 📊 REPORT — HTML (print-ready)
// ═══════════════════════════════════════════════════════════

router.get("/admin/report/html", (req, res) => {
  const { from, to, type, isImportant } = req.query;

  const whereClauses = [];
  const params = [];
  if (from) { whereClauses.push("created_at >= ?"); params.push(new Date(from)); }
  if (to) { whereClauses.push("created_at <= ?"); params.push(new Date(to)); }
  if (type) { whereClauses.push("type = ?"); params.push(type); }
  if (isImportant !== undefined) { whereClauses.push("isImportant = ?"); params.push(parseBoolean(isImportant)); }

  const whereSQL = whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : "";

  db.query(`SELECT * FROM notifications ${whereSQL} ORDER BY created_at DESC`, params, (err, rows) => {
    if (err) return res.status(500).send(`<h1>Report Error</h1><pre>${err.message}</pre>`);

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));

    const fmtDate = (d) => d
      ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
      : "—";

    const total = rows.length;
    const important = rows.filter(r => r.isImportant).length;
    const withFile = rows.filter(r => r.file).length;

    const rowsHTML = rows.map((r, idx) => `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td style="text-align:center;color:#6b7280;font-weight:600;">#${r.id}</td>
        <td>
          <div style="font-weight:600;color:#111827;">${esc(r.title)}</div>
          <div style="color:#4b5563;font-size:12px;line-height:1.4;margin-top:2px;">${esc((r.message || "").slice(0, 150))}${r.message?.length > 150 ? "…" : ""}</div>
        </td>
        <td style="text-align:center;">${esc(r.type || "general")}</td>
        <td style="text-align:center;">${r.isImportant ? '★ Yes' : 'No'}</td>
        <td style="text-align:center;">${r.file ? `<a href="${esc(r.file)}" style="color:#2563eb;">📎 File</a>` : '—'}</td>
        <td style="text-align:right;color:#6b7280;font-size:11px;white-space:nowrap;">${fmtDate(r.created_at)}</td>
      </tr>
    `).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Notification Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; background: #f4f6f9; color: #1f2937; padding: 20px; }
  .container { max-width: 1100px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); overflow: hidden; }
  .header { background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); color: #fff; padding: 24px 32px; }
  .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
  .header .sub { opacity: 0.9; font-size: 13px; }
  .header .meta-row { margin-top: 12px; display: flex; gap: 24px; flex-wrap: wrap; font-size: 12px; opacity: 0.95; }
  .body { padding: 24px 32px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 22px; }
  .stat-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; text-align: center; }
  .stat-label { font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; }
  .stat-value { font-size: 22px; font-weight: 700; color: #111827; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead { background: #1e3a8a; color: #fff; }
  th { padding: 10px 8px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; }
  td { padding: 10px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr:nth-child(even) { background: #f9fafb; }
  .footer { text-align: center; padding: 16px; background: #f9fafb; color: #6b7280; font-size: 11px; border-top: 1px solid #e5e7eb; }
  .toolbar { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 32px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
  .btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
  .btn-primary { background: #2563eb; color: #fff; }
  @media print {
    body { background: #fff; padding: 0; }
    .container { box-shadow: none; border-radius: 0; }
    .toolbar { display: none; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="toolbar">
    <button onclick="window.print()" class="btn btn-primary">🖨 Print / Save PDF</button>
  </div>
  <div class="header">
    <h1>📢 Notification Report</h1>
    <div class="sub">Govt. Sr. Sec. School Shilla</div>
    <div class="meta-row">
      <span><strong>Generated:</strong> ${fmtDate(new Date())}</span>
      <span><strong>Period:</strong> ${from || to ? `${from || "start"} → ${to || "now"}` : "All time"}</span>
      ${type ? `<span><strong>Type:</strong> ${esc(type)}</span>` : ""}
    </div>
  </div>
  <div class="body">
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${total}</div></div>
      <div class="stat-card"><div class="stat-label">Important</div><div class="stat-value">${important}</div></div>
      <div class="stat-card"><div class="stat-label">With File</div><div class="stat-value">${withFile}</div></div>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width:50px;text-align:center;">Sr.</th>
          <th style="width:60px;text-align:center;">ID</th>
          <th>Title & Message</th>
          <th style="width:100px;text-align:center;">Type</th>
          <th style="width:80px;text-align:center;">Important</th>
          <th style="width:80px;text-align:center;">File</th>
          <th style="width:130px;text-align:right;">Created</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHTML || `<tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af;">No notifications found</td></tr>`}
      </tbody>
    </table>
  </div>
  <div class="footer">Report generated by Notification Management System • ${new Date().toLocaleString("en-IN")}</div>
</div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });
});

// ═══════════════════════════════════════════════════════════
// 🔔 NOTIFICATION CRUD
// ═══════════════════════════════════════════════════════════

// GET ALL (admin)
router.get("/admin/all", (req, res) => {
  let { limit = 200, offset = 0, type, isImportant, search } = req.query;
  limit = Math.min(Math.max(parseInt(limit) || 200, 1), 500);
  offset = Math.max(parseInt(offset) || 0, 0);

  const whereClauses = [];
  const params = [];
  if (type) { whereClauses.push("type = ?"); params.push(type); }
  if (isImportant !== undefined) { whereClauses.push("isImportant = ?"); params.push(parseBoolean(isImportant)); }
  if (search) { whereClauses.push("(title LIKE ? OR message LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }

  const whereSQL = whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : "";

  db.query(
    `SELECT * FROM notifications ${whereSQL} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed to fetch", error: err.message });
      res.json({ success: true, count: result.length, data: result });
    }
  );
});

// ADD
router.post("/admin/add", upload.single("file"), async (req, res) => {
  try {
    const { title, message, description, type, attendance, isImportant, is_active, link } = req.body;

    const finalTitle = title;
    const finalMessage = message || description || "";
    const finalType = type || attendance || "general";
    const finalActive = is_active !== undefined ? parseBoolean(is_active, 1) : 1;

    const errors = validateNotification({ title: finalTitle, message: finalMessage });
    if (errors.length) {
      if (req.file?.filename) await deleteFromCloudinary(req.file.filename, req.file.mimetype);
      return res.status(400).json({ success: false, message: errors.join(", "), errors });
    }

    const fileUrl = req.file ? req.file.path : null;
    const filePublicId = req.file ? req.file.filename : null;
    const now = new Date();

    // Try full schema insert with fallback
    const insertFull = `INSERT INTO notifications 
       (title, message, file, file_public_id, type, isImportant, link, is_active, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.query(
      insertFull,
      [sanitizeString(finalTitle), sanitizeString(finalMessage), fileUrl, filePublicId,
       finalType, parseBoolean(isImportant, 0), link || null, finalActive, now],
      (err, result) => {
        if (err) {
          // Fallback: minimal schema
          const insertMin = `INSERT INTO notifications (title, message, file, created_at) VALUES (?, ?, ?, ?)`;
          db.query(insertMin, [sanitizeString(finalTitle), sanitizeString(finalMessage), fileUrl, now], (err2, result2) => {
            if (err2) {
              console.error("❌ DB Error:", err2);
              if (filePublicId) deleteFromCloudinary(filePublicId, req.file?.mimetype);
              return res.status(500).json({ success: false, message: "Failed to add", error: err2.message });
            }
            db.query("SELECT * FROM notifications WHERE id = ?", [result2.insertId], (fErr, fRes) => {
              res.status(201).json({
                success: true, message: "Notification added ✅",
                data: fRes?.[0] || { id: result2.insertId },
                file: fileUrl, filePublicId,
              });
            });
          });
          return;
        }

        db.query("SELECT * FROM notifications WHERE id = ?", [result.insertId], (fErr, fRes) => {
          res.status(201).json({
            success: true, message: "Notification added ✅",
            data: fRes?.[0] || { id: result.insertId },
            file: fileUrl, filePublicId,
          });
        });
      }
    );
  } catch (err) {
    console.error("❌ Add Error:", err);
    if (req.file?.filename) await deleteFromCloudinary(req.file.filename, req.file.mimetype);
    res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE
router.put("/admin/update/:id", upload.single("file"), async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    if (req.file?.filename) await deleteFromCloudinary(req.file.filename, req.file.mimetype);
    return res.status(400).json({ success: false, message: "Invalid ID" });
  }

  const { title, message, description, type, attendance, isImportant, is_active, link, removeFile } = req.body;

  db.query("SELECT * FROM notifications WHERE id = ?", [id], async (fetchErr, fetchResult) => {
    if (fetchErr) {
      if (req.file?.filename) await deleteFromCloudinary(req.file.filename, req.file.mimetype);
      return res.status(500).json({ success: false, message: "Failed", error: fetchErr.message });
    }
    if (!fetchResult.length) {
      if (req.file?.filename) await deleteFromCloudinary(req.file.filename, req.file.mimetype);
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const existing = fetchResult[0];
    let fileUrl = existing.file || existing.file_url;
    let filePublicId = existing.file_public_id;

    const shouldRemoveFile = removeFile === "true" || removeFile === true;
    if (shouldRemoveFile && filePublicId) {
      await deleteFromCloudinary(filePublicId, fileUrl || "");
      fileUrl = null;
      filePublicId = null;
    }

    if (req.file) {
      if (filePublicId) {
        await deleteFromCloudinary(filePublicId, fileUrl || "");
      }
      fileUrl = req.file.path;
      filePublicId = req.file.filename;
    }

    const finalTitle = title !== undefined ? title : existing.title;
    const finalMessage = message !== undefined ? message : (description !== undefined ? description : existing.message);
    const finalType = type || attendance || existing.type || "general";
    const finalActive = is_active !== undefined ? parseBoolean(is_active, 1) : (existing.is_active !== undefined ? existing.is_active : 1);
    const finalImportant = isImportant !== undefined ? parseBoolean(isImportant) : (existing.isImportant || 0);

    // Try full update
    db.query(
      `UPDATE notifications 
       SET title=?, message=?, type=?, isImportant=?, file=?, file_public_id=?, link=?, is_active=?
       WHERE id=?`,
      [
        sanitizeString(finalTitle), sanitizeString(finalMessage), finalType, finalImportant,
        fileUrl, filePublicId, link !== undefined ? link : existing.link, finalActive, id,
      ],
      (updateErr) => {
        if (updateErr) {
          // Fallback minimal
          db.query(
            `UPDATE notifications SET title=?, message=?, file=? WHERE id=?`,
            [sanitizeString(finalTitle), sanitizeString(finalMessage), fileUrl, id],
            (uErr2) => {
              if (uErr2) {
                if (req.file?.filename) deleteFromCloudinary(req.file.filename, req.file.mimetype);
                return res.status(500).json({ success: false, message: "Failed to update", error: uErr2.message });
              }
              db.query("SELECT * FROM notifications WHERE id = ?", [id], (fErr, fRes) => {
                res.json({ success: true, message: "Updated ✅", data: fRes?.[0] });
              });
            }
          );
          return;
        }

        db.query("SELECT * FROM notifications WHERE id = ?", [id], (fErr, fRes) => {
          res.json({ success: true, message: "Notification updated ✅", data: fRes?.[0] || null });
        });
      }
    );
  });
});

// DELETE
router.delete("/admin/delete/:id", (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

  db.query("SELECT * FROM notifications WHERE id = ?", [id], async (fetchErr, fetchResult) => {
    if (fetchErr) return res.status(500).json({ success: false, message: "Failed", error: fetchErr.message });
    if (!fetchResult.length) return res.status(404).json({ success: false, message: "Not found" });

    const notification = fetchResult[0];
    const pid = notification.file_public_id;
    const fileHint = notification.file || notification.file_url || "";
    if (pid) await deleteFromCloudinary(pid, fileHint);

    db.query("DELETE FROM notifications WHERE id = ?", [id], (delErr) => {
      if (delErr) return res.status(500).json({ success: false, message: "Failed to delete", error: delErr.message });
      res.json({ success: true, message: "Deleted ✅" });
    });
  });
});

// BULK DELETE
router.delete("/admin/bulk-delete", async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ success: false, message: "ids array required" });
  }
  const validIds = ids.filter(i => !isNaN(i)).map(Number);
  if (!validIds.length) return res.status(400).json({ success: false, message: "No valid IDs" });

  db.query("SELECT id, file_public_id, file FROM notifications WHERE id IN (?)", [validIds], async (fErr, rows) => {
    if (fErr) return res.status(500).json({ success: false, message: "Failed", error: fErr.message });

    if (rows.length) {
      await Promise.all(rows.map(r => r.file_public_id ? deleteFromCloudinary(r.file_public_id, r.file || "") : Promise.resolve()));
    }

    db.query("DELETE FROM notifications WHERE id IN (?)", [validIds], (dErr, result) => {
      if (dErr) return res.status(500).json({ success: false, message: "Failed", error: dErr.message });
      res.json({
        success: true,
        message: `${result.affectedRows} deleted ✅`,
        deletedCount: result.affectedRows,
      });
    });
  });
});

// TOGGLE IMPORTANT
router.patch("/admin/toggle-important/:id", (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

  db.query(
    "UPDATE notifications SET isImportant = NOT isImportant WHERE id = ?",
    [id],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "Not found" });

      db.query("SELECT * FROM notifications WHERE id = ?", [id], (fErr, fRes) => {
        res.json({ success: true, message: "Toggled ✅", data: fRes?.[0] || null });
      });
    }
  );
});

// ═══════════════════════════════════════════════════════════
// 🌐 PUBLIC ROUTES (no auth)
// ═══════════════════════════════════════════════════════════

// GET ALL PUBLIC
router.get("/", (req, res) => {
  let { limit = 50, offset = 0, type, search } = req.query;
  limit = Math.min(Math.max(parseInt(limit) || 50, 1), 100);
  offset = Math.max(parseInt(offset) || 0, 0);

  const whereClauses = ["is_active = 1"];
  const params = [];
  if (type) { whereClauses.push("type = ?"); params.push(type); }
  if (search) { whereClauses.push("(title LIKE ? OR message LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }

  const whereSQL = "WHERE " + whereClauses.join(" AND ");

  db.query(
    `SELECT * FROM notifications ${whereSQL} ORDER BY isImportant DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      res.json({ success: true, count: result.length, data: result });
    }
  );
});

// GET IMPORTANT (public)
router.get("/important", (req, res) => {
  db.query(
    "SELECT * FROM notifications WHERE isImportant = 1 AND is_active = 1 ORDER BY id DESC LIMIT 50",
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      res.json({ success: true, count: result.length, data: result });
    }
  );
});

// GET RECENT (public)
router.get("/recent", (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
  db.query(
    "SELECT * FROM notifications WHERE is_active = 1 ORDER BY id DESC LIMIT ?",
    [limit],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      res.json({ success: true, count: result.length, data: result });
    }
  );
});

// SEARCH (public)
router.get("/search/:query", (req, res) => {
  const searchQuery = req.params.query?.trim();
  if (!searchQuery || searchQuery.length < 2) {
    return res.status(400).json({ success: false, message: "Min 2 characters" });
  }
  db.query(
    `SELECT * FROM notifications WHERE (title LIKE ? OR message LIKE ?) AND is_active = 1 ORDER BY id DESC LIMIT 20`,
    [`%${searchQuery}%`, `%${searchQuery}%`],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
      res.json({ success: true, count: result.length, data: result });
    }
  );
});

// GET SINGLE (public)
router.get("/:id", (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

  db.query("SELECT * FROM notifications WHERE id = ? AND is_active = 1", [id], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Failed", error: err.message });
    if (!result.length) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: result[0] });
  });
});

module.exports = router;
