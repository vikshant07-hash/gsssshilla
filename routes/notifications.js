const express = require("express");
const router = express.Router();
const multer = require("multer");
const cloudinary = require("../config/cloudinary").cloudinary;
const db = require("../config/db").db || require("../config/db");
const fs = require("fs");
const path = require("path");
const { uploadRecent } = require("../config/cloudinary");

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

const tsForFile = () => new Date().toISOString().replace(/[:.]/g, "-");

const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
    console.log("✅ Cloudinary deleted:", publicId);
  } catch (err) {
    console.error("❌ Cloudinary delete error:", err.message);
  }
};

// ═══════════════════════════════════════════════════════════
// BACKUP FOLDER
// ═══════════════════════════════════════════════════════════

const BACKUP_DIR = path.join(__dirname, "..", "backups");
try {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log("✅ Backups folder created:", BACKUP_DIR);
  } else {
    console.log("✅ Backups folder ready");
  }
} catch (dirErr) {
  console.warn("⚠️ Backups folder error:", dirErr.message);
}

// ═══════════════════════════════════════════════════════════
// JSON upload for restore
// ═══════════════════════════════════════════════════════════

const jsonUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/json" || file.originalname.endsWith(".json")) {
      cb(null, true);
    } else {
      cb(new Error("Only JSON files allowed"));
    }
  },
});

// ═══════════════════════════════════════════════════════════
// 📊 REPORT — CSV (must be before /admin/:id routes)
// ═══════════════════════════════════════════════════════════

router.get("/admin/report", (req, res) => {
  const { from, to } = req.query;
  const whereClauses = [];
  const params = [];

  if (from) { whereClauses.push("created_at >= ?"); params.push(new Date(from)); }
  if (to) { whereClauses.push("created_at <= ?"); params.push(new Date(to)); }

  const whereSQL = whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : "";

  db.query(`SELECT * FROM notifications ${whereSQL} ORDER BY created_at DESC`, params, (err, rows) => {
    if (err) {
      console.error("❌ Report error:", err);
      return res.status(500).json({ success: false, message: "Report failed", error: err.message });
    }

    if (req.query.format === "csv") {
      const headers = ["ID", "Title", "Description", "Attendance", "Active", "File URL", "Created At"];
      const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csvLines = [headers.join(",")];

      rows.forEach(r => {
        csvLines.push([
          r.id,
          r.title || "",
          r.description || "",
          r.attendance || "all",
          r.is_active ? "Yes" : "No",
          r.file_url || "",
          r.created_at ? new Date(r.created_at).toISOString() : "",
        ].map(escape).join(","));
      });

      const csv = "\uFEFF" + csvLines.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="notification-report-${tsForFile()}.csv"`);
      return res.send(csv);
    }

    res.json({ success: true, data: { total: rows.length, notifications: rows } });
  });
});

// ═══════════════════════════════════════════════════════════
// 📊 REPORT — HTML (print)
// ═══════════════════════════════════════════════════════════

router.get("/admin/report/html", (req, res) => {
  const { from, to } = req.query;
  const whereClauses = [];
  const params = [];
  if (from) { whereClauses.push("created_at >= ?"); params.push(new Date(from)); }
  if (to) { whereClauses.push("created_at <= ?"); params.push(new Date(to)); }
  const whereSQL = whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : "";

  db.query(`SELECT * FROM notifications ${whereSQL} ORDER BY created_at DESC`, params, (err, rows) => {
    if (err) return res.status(500).send(`<h1>Error</h1><pre>${err.message}</pre>`);

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));

    const fmt = (d) => d ? new Date(d).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true
    }) : "—";

    const rowsHTML = rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>#${r.id}</td>
        <td><b>${esc(r.title)}</b><br><small style="color:#666;">${esc((r.description || "").slice(0, 200))}</small></td>
        <td>${esc(r.attendance || "all")}</td>
        <td>${r.is_active ? "Active" : "Inactive"}</td>
        <td>${fmt(r.created_at)}</td>
      </tr>
    `).join("");

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Notification Report</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 30px; color: #1a2332; }
    h1 { color: #c9972b; border-bottom: 3px solid #c9972b; padding-bottom: 10px; margin-bottom: 6px; }
    .meta { color: #666; font-size: 13px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #1e3a8a; color: #fff; padding: 10px; text-align: left; font-size: 12px; text-transform: uppercase; }
    td { padding: 10px; border-bottom: 1px solid #ddd; vertical-align: top; }
    tr:nth-child(even) { background: #f9fafb; }
    .btn-print { padding: 10px 22px; background: #1e3a8a; color: #fff; border: none; border-radius: 6px; cursor: pointer; margin-bottom: 16px; font-size: 14px; font-weight: 600; }
    .btn-print:hover { background: #0f172a; }
    @media print { .btn-print { display: none; } body { padding: 10px; } }
  </style>
</head>
<body>
  <button class="btn-print" onclick="window.print()">🖨 Print / Save as PDF</button>
  <h1>📢 Notification Report</h1>
  <div class="meta">Generated: ${fmt(new Date())} | Total Records: ${rows.length}</div>
  <table>
    <thead>
      <tr>
        <th style="width:50px;">#</th>
        <th style="width:70px;">ID</th>
        <th>Title & Description</th>
        <th style="width:100px;">Target</th>
        <th style="width:100px;">Status</th>
        <th style="width:160px;">Created</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHTML || '<tr><td colspan="6" style="text-align:center;padding:40px;color:#999;">No notifications found</td></tr>'}
    </tbody>
  </table>
</body>
</html>`);
  });
});

// ═══════════════════════════════════════════════════════════
// 📦 BACKUP — DOWNLOAD
// ═══════════════════════════════════════════════════════════

router.get("/admin/backup", (req, res) => {
  console.log("📦 Backup request received");

  db.query("SELECT * FROM notifications ORDER BY id ASC", (err, rows) => {
    if (err) {
      console.error("❌ Backup DB Error:", err);
      return res.status(500).json({ success: false, message: "Backup failed", error: err.message });
    }

    console.log(`✅ Fetched ${rows.length} notifications for backup`);

    const backupData = {
      meta: {
        system: "Notification System",
        version: "1.0",
        generatedAt: new Date().toISOString(),
        totalRecords: rows.length,
      },
      notifications: rows,
    };

    const fileName = `notifications-backup-${tsForFile()}.json`;

    try {
      fs.writeFileSync(path.join(BACKUP_DIR, fileName), JSON.stringify(backupData, null, 2));
      console.log("✅ Backup saved:", fileName);
    } catch (e) {
      console.warn("⚠️ Could not save on server:", e.message);
    }

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
    if (!fs.existsSync(BACKUP_DIR)) return res.json({ success: true, count: 0, data: [] });
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("notifications-backup-") && f.endsWith(".json"))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          fileName: f,
          sizeKB: (stat.size / 1024).toFixed(2),
          createdAt: stat.birthtime || stat.mtime,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, count: files.length, data: files });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: "Not found" });
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
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: "Not found" });
  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, message: "Backup deleted ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
      backupData = JSON.parse(req.file.buffer.toString("utf8"));
      console.log("✅ Parsed:", req.file.originalname);
    } else if (req.body?.backup) {
      backupData = typeof req.body.backup === "string" ? JSON.parse(req.body.backup) : req.body.backup;
    } else {
      return res.status(400).json({ success: false, message: "No backup data provided" });
    }

    const notifications = backupData.notifications || backupData.data || backupData;
    if (!Array.isArray(notifications) || !notifications.length) {
      return res.status(400).json({ success: false, message: "Invalid backup format" });
    }

    const mode = req.body?.mode || "merge";
    const results = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    for (const n of notifications) {
      await new Promise((resolve) => {
        if (!n.title || !n.description) { results.skipped++; return resolve(); }

        const id = n.id || null;
        const title = n.title;
        const description = n.description;
        const file_url = n.file_url || null;
        const public_id = n.public_id || null;
        const file_name = n.file_name || null;
        const file_size = n.file_size || null;
        const file_type = n.file_type || null;
        const attendance = n.attendance || "all";
        const is_active = n.is_active !== undefined ? n.is_active : 1;

        const checkExists = id
          ? new Promise((resolve, reject) => {
              db.query("SELECT id FROM notifications WHERE id = ?", [id], (e, r) => {
                if (e) reject(e); else resolve(r);
              });
            })
          : Promise.resolve([]);

        checkExists.then((existing) => {
          const exists = existing?.length > 0;

          if (exists && mode === "merge") {
            db.query(
              "UPDATE notifications SET title=?, description=?, file_url=?, public_id=?, file_name=?, file_size=?, file_type=?, attendance=?, is_active=? WHERE id=?",
              [title, description, file_url, public_id, file_name, file_size, file_type, attendance, is_active, id],
              (uErr) => {
                if (uErr) { results.errors.push({ id, error: uErr.message }); results.skipped++; }
                else results.updated++;
                resolve();
              }
            );
          } else if (exists && mode === "replace") {
            db.query("DELETE FROM notifications WHERE id = ?", [id], () => {
              const insQ = "INSERT INTO notifications (id, title, description, file_url, public_id, file_name, file_size, file_type, attendance, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
              db.query(insQ, [id, title, description, file_url, public_id, file_name, file_size, file_type, attendance, is_active], (iErr) => {
                if (iErr) { results.errors.push({ id, error: iErr.message }); results.skipped++; }
                else results.updated++;
                resolve();
              });
            });
          } else {
            const insQ = id
              ? "INSERT INTO notifications (id, title, description, file_url, public_id, file_name, file_size, file_type, attendance, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              : "INSERT INTO notifications (title, description, file_url, public_id, file_name, file_size, file_type, attendance, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
            const params = id
              ? [id, title, description, file_url, public_id, file_name, file_size, file_type, attendance, is_active]
              : [title, description, file_url, public_id, file_name, file_size, file_type, attendance, is_active];

            db.query(insQ, params, (iErr) => {
              if (iErr) { results.errors.push({ id, error: iErr.message }); results.skipped++; }
              else { if (id) results.updated++; else results.inserted++; }
              resolve();
            });
          }
        }).catch((err) => {
          results.errors.push({ id, error: err.message });
          results.skipped++;
          resolve();
        });
      });
    }

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
// 🔔 NOTIFICATION CRUD — EXACTLY SAME AS OLD app.js ROUTES
// ═══════════════════════════════════════════════════════════

// GET ALL (admin) — same format as old
router.get("/admin/all", (req, res) => {
  db.query(
    `SELECT *, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist 
     FROM notifications ORDER BY created_at DESC`,
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true, data: results || [] });
    }
  );
});

// ADD — same format as old
router.post("/admin/add", uploadRecent.single("file"), (req, res) => {
  const { title, description, attendance } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, message: "Title is required" });
  }

  const file_url = req.file ? req.file.path : null;
  const public_id = req.file ? req.file.filename : null;
  const file_name = req.file ? req.file.originalname : null;
  const file_size = req.file ? req.file.size : null;
  const file_type = req.file ? req.file.mimetype : null;

  db.query(
    `INSERT INTO notifications (title, description, file_url, public_id, file_name, file_size, file_type, attendance, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [title, description || "", file_url, public_id, file_name, file_size, file_type, attendance || "all"],
    (err, result) => {
      if (err) {
        console.error("❌ Insert Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.status(201).json({
        success: true,
        message: "✅ Notification added successfully!",
        data: { id: result.insertId }
      });
    }
  );
});

// UPDATE — same format as old
router.put("/admin/update/:id", uploadRecent.single("file"), (req, res) => {
  const { id } = req.params;
  const { title, description, attendance, is_active } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, message: "Title is required" });
  }

  db.query("SELECT * FROM notifications WHERE id = ?", [id], (fetchErr, fetchResult) => {
    if (fetchErr || !fetchResult || fetchResult.length === 0) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    const existing = fetchResult[0];
    let file_url = existing.file_url;
    let public_id = existing.public_id;
    let file_name = existing.file_name;
    let file_size = existing.file_size;
    let file_type = existing.file_type;

    if (req.file) {
      if (existing.public_id) deleteFromCloudinary(existing.public_id);
      file_url = req.file.path;
      public_id = req.file.filename;
      file_name = req.file.originalname;
      file_size = req.file.size;
      file_type = req.file.mimetype;
    }

    db.query(
      `UPDATE notifications SET title=?, description=?, file_url=?, public_id=?, file_name=?, file_size=?, file_type=?, attendance=?, is_active=?, updated_at=NOW() WHERE id=?`,
      [
        title,
        description || existing.description,
        file_url,
        public_id,
        file_name,
        file_size,
        file_type,
        attendance || existing.attendance || "all",
        is_active !== undefined ? parseInt(is_active) : existing.is_active,
        id
      ],
      (updateErr) => {
        if (updateErr) {
          console.error("❌ Update Error:", updateErr);
          return res.status(500).json({ success: false, error: updateErr.message });
        }
        res.json({ success: true, message: "✅ Notification updated successfully!" });
      }
    );
  });
});

// DELETE — same format as old
router.delete("/admin/delete/:id", (req, res) => {
  const { id } = req.params;

  db.query("SELECT * FROM notifications WHERE id = ?", [id], (fetchErr, fetchResult) => {
    if (fetchErr || !fetchResult || fetchResult.length === 0) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    const notification = fetchResult[0];
    if (notification.public_id) deleteFromCloudinary(notification.public_id);

    db.query("DELETE FROM notifications WHERE id = ?", [id], (deleteErr) => {
      if (deleteErr) {
        console.error("❌ Delete Error:", deleteErr);
        return res.status(500).json({ success: false, error: deleteErr.message });
      }
      res.json({ success: true, message: "✅ Notification deleted successfully!" });
    });
  });
});

// BULK DELETE — same format as old
router.delete("/admin/bulk-delete", (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No IDs provided" });
  }

  const placeholders = ids.map(() => '?').join(',');

  db.query(`SELECT * FROM notifications WHERE id IN (${placeholders})`, ids, (fetchErr, fetchResults) => {
    if (fetchErr) {
      return res.status(500).json({ success: false, error: fetchErr.message });
    }

    fetchResults.forEach(n => {
      if (n.public_id) deleteFromCloudinary(n.public_id);
    });

    db.query(`DELETE FROM notifications WHERE id IN (${placeholders})`, ids, (deleteErr) => {
      if (deleteErr) {
        return res.status(500).json({ success: false, error: deleteErr.message });
      }
      res.json({ success: true, message: `${ids.length} notifications deleted successfully ✅` });
    });
  });
});

module.exports = router;
