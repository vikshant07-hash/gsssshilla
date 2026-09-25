const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const path = require("path");

// ═══════════════════════════════════════════════════════════
// IMPORTS (aapke config/db.js se)
// ═══════════════════════════════════════════════════════════
const {
  db, query, transaction, getById, count, exists, blogQuery
} = require("../config/db");

const {
  cloudinary,
  uploadSlider, uploadRecent, uploadGallery, uploadDownload,
  uploadFaculty, uploadStudent,
  uploadBlogCover, uploadBlogContent, uploadBlogAvatar,
  uploadBlogFile, uploadBlogBase64, deleteBlogFromCloudinary
} = require("../config/cloudinary");

const router = express.Router();

// ═══════════════════════════════════════════════════════════
// ⚙️ CONFIG
// ═══════════════════════════════════════════════════════════
const MAX_FILE_SIZE = 100 * 1024 * 1024;             // 100 MB per file
const MAX_STORAGE_BYTES = 5 * 1024 * 1024 * 1024;    // 5 GB per user
const TRASH_RETENTION_DAYS = 30;

// ═══════════════════════════════════════════════════════════
// 🛠️ HELPERS
// ═══════════════════════════════════════════════════════════
const cvSlugify = (text) =>
  String(text || "").toLowerCase().trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 200);

const cvAsync = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error("FilesRoutes Error:", err);
    res.status(500).json({ success: false, error: err.message });
  });

const fmtSize = (b) => {
  if (!b) return "0 B";
  const k = 1024, s = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(2) + " " + s[i];
};

const getCategory = (ext) => {
  const map = {
    img: ["jpg","jpeg","png","gif","webp","bmp","svg","heic","ico"],
    vid: ["mp4","mkv","mov","avi","webm","flv","m4v","wmv"],
    aud: ["mp3","wav","ogg","flac","m4a","aac","wma"],
    doc: ["pdf","doc","docx","txt","xls","xlsx","ppt","pptx","csv","rtf","odt","md"],
    arc: ["zip","rar","7z","tar","gz","bz2","xz"]
  };
  ext = (ext || "").toLowerCase();
  for (const [k, list] of Object.entries(map)) {
    if (list.includes(ext)) return k;
  }
  return "other";
};

// ═══════════════════════════════════════════════════════════
// ⏰ SMART TIME (IST — aapke blogRoutes se same)
// ═══════════════════════════════════════════════════════════
const parseDelhiDate = (dateStr) => {
  if (!dateStr) return null;
  if (typeof dateStr === "string" && (dateStr.includes("Z") || /[+-]\d{2}:?\d{2}$/.test(dateStr))) {
    return new Date(dateStr);
  }
  if (typeof dateStr === "string") {
    const normalized = dateStr.replace(" ", "T");
    return new Date(normalized + "+05:30");
  }
  return new Date(dateStr);
};

const formatDelhi = (date, format = "full") => {
  if (!date) return "";
  const opts = {
    full: { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true },
    date: { day: "numeric", month: "short", year: "numeric" },
    time: { hour: "2-digit", minute: "2-digit", hour12: true }
  };
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts[format] });
};

const timeAgo = (dateStr) => {
  if (!dateStr) return "";
  const then = parseDelhiDate(dateStr);
  if (!then || isNaN(then.getTime())) return "";
  const now = new Date();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 0) return formatDelhi(then, "full");
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hr ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)} days ago`;
  return formatDelhi(then, "date");
};

// ═══════════════════════════════════════════════════════════
// 🛡️ RATE LIMITER (aapke blogRoutes se same)
// ═══════════════════════════════════════════════════════════
const rateLimitStore = new Map();

const rateLimit = (options = {}) => {
  const {
    windowMs = 60 * 1000,
    max = 60,
    keyGenerator = (req) => req.ip,
    message = "Too many requests, please try again later"
  } = options;

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();
    const record = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }

    record.count++;
    rateLimitStore.set(key, record);

    if (record.count > max) {
      return res.status(429).json({
        success: false,
        error: message,
        retryAfter: Math.ceil((record.resetAt - now) / 1000)
      });
    }
    next();
  };
};

// Cleanup old rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitStore.entries()) {
    if (now > val.resetAt) rateLimitStore.delete(key);
  }
}, 5 * 60 * 1000);

// ═══════════════════════════════════════════════════════════
// 📝 ACTIVITY LOGGER
// ═══════════════════════════════════════════════════════════
const cvLogActivity = async (userId, action, target, ip, itemId = null) => {
  try {
    await blogQuery(
      `INSERT INTO cv_audit_trail 
       (log_user_id, log_action, log_target, log_item_id, log_ip)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, action, target || "", itemId, ip || ""]
    );
  } catch (e) {
    console.error("Audit log error:", e.message);
  }
};

// ═══════════════════════════════════════════════════════════
// 🔔 ALERT CREATOR
// ═══════════════════════════════════════════════════════════
const cvCreateAlert = async (userId, type, title, message, link) => {
  try {
    await blogQuery(
      `INSERT INTO cv_alerts (alert_user_id, alert_type, alert_title, alert_message, alert_link)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, type, title, message || null, link || null]
    );
  } catch (e) {
    console.error("Alert error:", e.message);
  }
};

// ═══════════════════════════════════════════════════════════
// 📤 CLOUDINARY UPLOAD HELPER
// ═══════════════════════════════════════════════════════════
const uploadToCloudinary = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || "cloudvault/files",
        resource_type: options.resource_type || "auto",
        public_id: options.public_id,
        overwrite: false
      },
      (err, result) => err ? reject(err) : resolve(result)
    );
    stream.end(buffer);
  });
};

// ═══════════════════════════════════════════════════════════
// 🧮 STORAGE CALCULATOR
// ═══════════════════════════════════════════════════════════
const getUserStorage = async (userId) => {
  const rows = await blogQuery(
    `SELECT COALESCE(SUM(item_size),0) AS used
     FROM cv_vault_items
     WHERE item_owner_id = ? AND item_is_folder = 0 AND item_trashed = 0`,
    [userId]
  );
  return Number(rows[0]?.used || 0);
};

// ═══════════════════════════════════════════════════════════
// 🔐 MIDDLEWARE
// ═══════════════════════════════════════════════════════════
const cvAuthRequired = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ success: false, error: "Authentication required" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
};

// ═══════════════════════════════════════════════════════════
// 🔐 1) SIGNUP → POST /api/files/auth/register
// ═══════════════════════════════════════════════════════════
router.post("/auth/register",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  cvAsync(async (req, res) => {
    const { name, username, email, password } = req.body;
    const finalName = name || username;

    if (!finalName || !email || !password)
      return res.status(400).json({ success: false, error: "All fields required" });
    if (password.length < 6)
      return res.status(400).json({ success: false, error: "Password must be 6+ characters" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ success: false, error: "Invalid email format" });
    if (finalName.length < 3)
      return res.status(400).json({ success: false, error: "Username min 3 characters" });

    // Check existing
    const existing = await blogQuery(
      "SELECT acc_id FROM cv_accounts WHERE acc_email = ? OR acc_username = ? LIMIT 1",
      [email, finalName]
    );
    if (existing.length)
      return res.status(409).json({ success: false, error: "Email or username already exists" });

    const hash = await bcrypt.hash(password, 10);
    const result = await blogQuery(
      `INSERT INTO cv_accounts 
       (acc_username, acc_email, acc_password, acc_full_name, acc_role, acc_status)
       VALUES (?, ?, ?, ?, 'user', 1)`,
      [finalName, email, hash, finalName]
    );

    // Create default preferences
    await blogQuery(
      `INSERT INTO cv_preferences (pref_user_id, pref_theme, pref_default_view)
       VALUES (?, 'light', 'grid')`,
      [result.insertId]
    );

    await cvLogActivity(result.insertId, "register", email, req.ip);

    const token = jwt.sign(
      { id: result.insertId, email, role: "user", username: finalName },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      token,
      user: {
        id: result.insertId,
        name: finalName,
        username: finalName,
        email,
        role: "user"
      }
    });
  })
);

// ═══════════════════════════════════════════════════════════
// 🔐 2) LOGIN → POST /api/files/auth/login
// ═══════════════════════════════════════════════════════════
router.post("/auth/login",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
  cvAsync(async (req, res) => {
    const { username, email, password } = req.body;
    const login = username || email;

    if (!login || !password)
      return res.status(400).json({ success: false, error: "Username and password required" });

    const rows = await blogQuery(
      "SELECT * FROM cv_accounts WHERE acc_username = ? OR acc_email = ? LIMIT 1",
      [login, login]
    );
    if (!rows.length)
      return res.status(401).json({ success: false, error: "Invalid credentials" });

    const user = rows[0];

    if (!user.acc_status)
      return res.status(403).json({ success: false, error: "Account is disabled" });

    const valid = await bcrypt.compare(password, user.acc_password);
    if (!valid)
      return res.status(401).json({ success: false, error: "Invalid credentials" });

    await blogQuery("UPDATE cv_accounts SET acc_last_login = NOW() WHERE acc_id = ?", [user.acc_id]);
    await cvLogActivity(user.acc_id, "login", user.acc_username, req.ip);

    const token = jwt.sign(
      { id: user.acc_id, email: user.acc_email, role: user.acc_role, username: user.acc_username },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.acc_id,
        name: user.acc_full_name || user.acc_username,
        username: user.acc_username,
        email: user.acc_email,
        role: user.acc_role,
        avatar: user.acc_avatar_url,
        storageUsed: user.acc_storage_used,
        storageLimit: user.acc_storage_limit
      }
    });
  })
);

// ═══════════════════════════════════════════════════════════
// 🔐 3) ME → GET /api/files/auth/me
// ═══════════════════════════════════════════════════════════
router.get("/auth/me", cvAuthRequired, cvAsync(async (req, res) => {
  const rows = await blogQuery(
    `SELECT acc_id AS id, acc_username AS username, acc_email AS email,
            acc_full_name AS name, acc_avatar_url AS avatar, acc_role AS role,
            acc_status AS status, acc_storage_used AS storageUsed,
            acc_storage_limit AS storageLimit, acc_last_login AS lastLogin,
            acc_created_at AS createdAt
     FROM cv_accounts WHERE acc_id = ?`,
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: "User not found" });

  const stats = await blogQuery(`
    SELECT 
      (SELECT COUNT(*) FROM cv_vault_items WHERE item_owner_id = ? AND item_is_folder = 0 AND item_trashed = 0) AS file_count,
      (SELECT COUNT(*) FROM cv_vault_items WHERE item_owner_id = ? AND item_is_folder = 1 AND item_trashed = 0) AS folder_count,
      (SELECT COALESCE(SUM(item_size),0) FROM cv_vault_items WHERE item_owner_id = ? AND item_is_folder = 0 AND item_trashed = 0) AS storage_used
  `, [req.user.id, req.user.id, req.user.id]);

  res.json({ success: true, ...rows[0], stats: stats[0] });
}));

// ═══════════════════════════════════════════════════════════
// 🔐 4) UPDATE PROFILE → PUT /api/files/auth/profile
// ═══════════════════════════════════════════════════════════
router.put("/auth/profile", cvAuthRequired, cvAsync(async (req, res) => {
  const { name, email } = req.body;

  const updates = [];
  const params = [];
  if (name) { updates.push("acc_full_name = ?"); params.push(name.trim()); }
  if (email) { updates.push("acc_email = ?"); params.push(email.trim().toLowerCase()); }

  if (!updates.length)
    return res.status(400).json({ success: false, error: "Nothing to update" });

  params.push(req.user.id);
  await blogQuery(`UPDATE cv_accounts SET ${updates.join(", ")} WHERE acc_id = ?`, params);

  await cvLogActivity(req.user.id, "update_profile", name || email, req.ip);
  res.json({ success: true, message: "Profile updated" });
}));

// ═══════════════════════════════════════════════════════════
// 🔐 5) CHANGE PASSWORD → PUT /api/files/auth/password
// ═══════════════════════════════════════════════════════════
router.put("/auth/password", cvAuthRequired, cvAsync(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ success: false, error: "Both passwords required" });
  if (new_password.length < 6)
    return res.status(400).json({ success: false, error: "Password must be 6+ characters" });

  const rows = await blogQuery("SELECT acc_password FROM cv_accounts WHERE acc_id = ?", [req.user.id]);
  if (!rows.length) return res.status(404).json({ success: false, error: "User not found" });

  const valid = await bcrypt.compare(current_password, rows[0].acc_password);
  if (!valid) return res.status(401).json({ success: false, error: "Current password wrong" });

  const hash = await bcrypt.hash(new_password, 10);
  await blogQuery("UPDATE cv_accounts SET acc_password = ? WHERE acc_id = ?", [hash, req.user.id]);

  await cvLogActivity(req.user.id, "change_password", "", req.ip);
  res.json({ success: true, message: "Password updated" });
}));

// ═══════════════════════════════════════════════════════════
// 🔐 6) UPLOAD AVATAR → POST /api/files/auth/avatar
// ═══════════════════════════════════════════════════════════
router.post("/auth/avatar", cvAuthRequired, uploadBlogAvatar.single("avatar"),
  cvAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });

    // Delete old avatar
    const rows = await blogQuery(
      "SELECT acc_avatar_public_id FROM cv_accounts WHERE acc_id = ?",
      [req.user.id]
    );
    if (rows[0]?.acc_avatar_public_id) {
      await deleteBlogFromCloudinary(rows[0].acc_avatar_public_id).catch(() => {});
    }

    await blogQuery(
      "UPDATE cv_accounts SET acc_avatar_url = ?, acc_avatar_public_id = ? WHERE acc_id = ?",
      [req.file.path, req.file.filename, req.user.id]
    );

    res.json({ success: true, url: req.file.path, public_id: req.file.filename });
  })
);

// ═══════════════════════════════════════════════════════════
// 📊 7) LIST FILES → GET /api/files
// ═══════════════════════════════════════════════════════════
router.get("/", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;
  const {
    view = "all",
    parent_id = null,
    search = "",
    sort = "date",
    order = "desc",
    page = 1,
    limit = 100
  } = req.query;

  let where = ["item_owner_id = ?"];
  let params = [uid];

  // Trash vs normal
  if (view !== "trash") {
    where.push("item_trashed = 0");
    if (parent_id !== null && parent_id !== "" && parent_id !== "null" && parent_id !== "undefined") {
      where.push("item_parent_id = ?");
      params.push(Number(parent_id));
    } else {
      where.push("item_parent_id IS NULL");
    }
  } else {
    where.push("item_trashed = 1");
  }

  if (view === "starred") where.push("item_starred = 1");

  if (["images","docs","videos","audio","archives"].includes(view)) {
    const map = { images:"img", docs:"doc", videos:"vid", audio:"aud", archives:"arc" };
    where.push("item_category = ?");
    params.push(map[view]);
  }

  if (search) {
    where.push("(item_name LIKE ? OR item_original_name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  const sortMap = { name: "item_name", date: "item_created_at", size: "item_size", type: "item_ext" };
  const sortCol = sortMap[sort] || "item_created_at";
  const sortOrder = order.toLowerCase() === "asc" ? "ASC" : "DESC";
  const offset = (Number(page) - 1) * Number(limit);

  const sql = `
    SELECT 
      item_id AS id, item_name AS name, item_original_name AS original_name,
      item_size AS file_size, item_mime AS mime_type, item_ext AS extension,
      item_category AS category, item_cloud_url AS cloud_url, item_public_id AS public_id,
      item_resource_type AS resource_type, item_is_folder AS is_folder,
      item_parent_id AS parent_id, item_starred AS starred, item_trashed AS trashed,
      item_trashed_at AS trashed_at, item_download_count AS download_count,
      item_created_at AS created_at, item_updated_at AS updated_at
    FROM cv_vault_items
    WHERE ${where.join(" AND ")}
    ORDER BY item_is_folder DESC, ${sortCol} ${sortOrder}
    LIMIT ? OFFSET ?
  `;
  params.push(Number(limit), offset);

  const files = await blogQuery(sql, params);

  const countRows = await blogQuery(
    `SELECT COUNT(*) AS total FROM cv_vault_items WHERE ${where.join(" AND ")}`,
    params.slice(0, params.length - 2)
  );

  const used = await getUserStorage(uid);

  // Add time_ago to each file
  files.forEach(f => {
    f.time_ago = timeAgo(f.created_at);
    f.created_at_formatted = formatDelhi(parseDelhiDate(f.created_at), "full");
  });

  res.json({
    success: true,
    count: files.length,
    total: countRows[0]?.total || 0,
    page: Number(page),
    totalPages: Math.ceil((countRows[0]?.total || 0) / Number(limit)),
    files,
    storage: {
      used,
      usedFormatted: fmtSize(used),
      max: MAX_STORAGE_BYTES,
      maxFormatted: fmtSize(MAX_STORAGE_BYTES),
      percent: Math.min(100, (used / MAX_STORAGE_BYTES) * 100).toFixed(1)
    }
  });
}));

// ═══════════════════════════════════════════════════════════
// 📤 8) UPLOAD FILE(S) → POST /api/files/upload
// ═══════════════════════════════════════════════════════════
router.post("/upload", cvAuthRequired, uploadBlogFile.array("files", 20),
  cvAsync(async (req, res) => {
    const uid = req.user.id;
    const parent_id = req.body.parent_id || null;

    if (!req.files || req.files.length === 0)
      return res.status(400).json({ success: false, error: "No files uploaded" });

    // Quota check
    const totalNew = req.files.reduce((s, f) => s + (f.size || 0), 0);
    const used = await getUserStorage(uid);
    if (used + totalNew > MAX_STORAGE_BYTES) {
      return res.status(413).json({
        success: false,
        error: `Storage quota exceeded. Used: ${fmtSize(used)} / ${fmtSize(MAX_STORAGE_BYTES)}`
      });
    }

    const uploaded = [];
    const errors = [];

    for (const file of req.files) {
      try {
        const originalName = file.originalname || file.name || "file";
        const ext = path.extname(originalName).replace(".", "").toLowerCase();
        const category = getCategory(ext);

        let resource_type = "raw";
        if (category === "img") resource_type = "image";
        else if (category === "vid") resource_type = "video";

        const result = await blogQuery(
          `INSERT INTO cv_vault_items 
           (item_owner_id, item_name, item_original_name, item_size, item_mime,
            item_ext, item_category, item_cloud_url, item_public_id, item_resource_type,
            item_is_folder, item_parent_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [
            uid, originalName, originalName, file.size || 0,
            file.mimetype || "application/octet-stream",
            ext, category, file.path, file.filename,
            resource_type, parent_id
          ]
        );

        await cvLogActivity(uid, "upload", originalName, req.ip, result.insertId);
        uploaded.push({
          id: result.insertId,
          name: originalName,
          size: file.size,
          url: file.path
        });
      } catch (err) {
        console.error("Upload file error:", err);
        errors.push({ file: file.originalname, error: err.message });
      }
    }

    res.json({
      success: true,
      message: `${uploaded.length} file(s) uploaded`,
      uploaded,
      errors: errors.length ? errors : undefined
    });
  })
);

// ═══════════════════════════════════════════════════════════
// 📁 9) CREATE FOLDER → POST /api/files/folder
// ═══════════════════════════════════════════════════════════
router.post("/folder", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;
  const { name, parent_id = null } = req.body;

  if (!name || !name.trim())
    return res.status(400).json({ success: false, error: "Folder name required" });

  const result = await blogQuery(
    `INSERT INTO cv_vault_items 
     (item_owner_id, item_name, item_original_name, item_size, item_mime,
      item_ext, item_category, item_is_folder, item_parent_id)
     VALUES (?, ?, ?, 0, 'folder', '', 'folder', 1, ?)`,
    [uid, name.trim(), name.trim(), parent_id]
  );

  await cvLogActivity(uid, "create_folder", name, req.ip, result.insertId);
  res.json({ success: true, id: result.insertId, name: name.trim() });
}));

// ═══════════════════════════════════════════════════════════
// ⬇️ 10) DOWNLOAD → GET /api/files/:id/download
// ═══════════════════════════════════════════════════════════
router.get("/:id/download", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const rows = await blogQuery(
    `SELECT item_id, item_cloud_url, item_name FROM cv_vault_items 
     WHERE item_id = ? AND item_owner_id = ? AND item_is_folder = 0`,
    [req.params.id, uid]
  );

  if (!rows.length) return res.status(404).json({ success: false, error: "File not found" });

  const f = rows[0];
  await blogQuery(
    "UPDATE cv_vault_items SET item_download_count = item_download_count + 1 WHERE item_id = ?",
    [f.item_id]
  );
  await cvLogActivity(uid, "download", f.item_name, req.ip, f.item_id);

  const downloadUrl = f.item_cloud_url?.includes("/upload/")
    ? f.item_cloud_url.replace("/upload/", "/upload/fl_attachment/")
    : f.item_cloud_url;

  res.redirect(downloadUrl);
}));

// ═══════════════════════════════════════════════════════════
// 👁️ 11) PREVIEW → GET /api/files/:id/preview
// ═══════════════════════════════════════════════════════════
router.get("/:id/preview", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const rows = await blogQuery(
    `SELECT item_cloud_url, item_resource_type, item_mime 
     FROM cv_vault_items WHERE item_id = ? AND item_owner_id = ? AND item_is_folder = 0`,
    [req.params.id, uid]
  );

  if (!rows.length) return res.status(404).json({ success: false, error: "Not found" });

  res.json({
    success: true,
    url: rows[0].item_cloud_url,
    resource_type: rows[0].item_resource_type,
    mime: rows[0].item_mime
  });
}));

// ═══════════════════════════════════════════════════════════
// ✏️ 12) RENAME → PATCH /api/files/:id/rename
// ═══════════════════════════════════════════════════════════
router.patch("/:id/rename", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;
  const { name } = req.body;

  if (!name || !name.trim())
    return res.status(400).json({ success: false, error: "Name required" });

  const r = await blogQuery(
    "UPDATE cv_vault_items SET item_name = ? WHERE item_id = ? AND item_owner_id = ?",
    [name.trim(), req.params.id, uid]
  );

  if (!r.affectedRows) return res.status(404).json({ success: false, error: "Not found" });

  await cvLogActivity(uid, "rename", name, req.ip, req.params.id);
  res.json({ success: true, message: "Renamed" });
}));

// ═══════════════════════════════════════════════════════════
// ⭐ 13) STAR / UNSTAR → PATCH /api/files/:id/star
// ═══════════════════════════════════════════════════════════
router.patch("/:id/star", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const rows = await blogQuery(
    "SELECT item_starred FROM cv_vault_items WHERE item_id = ? AND item_owner_id = ?",
    [req.params.id, uid]
  );

  if (!rows.length) return res.status(404).json({ success: false, error: "Not found" });

  const newVal = rows[0].item_starred ? 0 : 1;
  await blogQuery("UPDATE cv_vault_items SET item_starred = ? WHERE item_id = ?", [newVal, req.params.id]);

  res.json({ success: true, starred: !!newVal });
}));

// ═══════════════════════════════════════════════════════════
// 🗑️ 14) MOVE TO TRASH → DELETE /api/files/:id
// ═══════════════════════════════════════════════════════════
router.delete("/:id", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const rows = await blogQuery(
    "SELECT * FROM cv_vault_items WHERE item_id = ? AND item_owner_id = ?",
    [req.params.id, uid]
  );

  if (!rows.length) return res.status(404).json({ success: false, error: "Not found" });

  const f = rows[0];

  if (f.item_is_folder) {
    await trashFolderRecursive(f.item_id, uid);
  }

  await blogQuery(
    "UPDATE cv_vault_items SET item_trashed = 1, item_trashed_at = NOW() WHERE item_id = ?",
    [f.item_id]
  );

  await cvLogActivity(uid, "trash", f.item_name, req.ip, f.item_id);
  res.json({ success: true, message: "Moved to trash" });
}));

async function trashFolderRecursive(folderId, uid) {
  const children = await blogQuery(
    "SELECT item_id, item_is_folder FROM cv_vault_items WHERE item_parent_id = ? AND item_owner_id = ?",
    [folderId, uid]
  );

  for (const c of children) {
    if (c.item_is_folder) await trashFolderRecursive(c.item_id, uid);
    await blogQuery(
      "UPDATE cv_vault_items SET item_trashed = 1, item_trashed_at = NOW() WHERE item_id = ?",
      [c.item_id]
    );
  }
}

// ═══════════════════════════════════════════════════════════
// ♻️ 15) RESTORE → POST /api/files/:id/restore
// ═══════════════════════════════════════════════════════════
router.post("/:id/restore", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const rows = await blogQuery(
    "SELECT * FROM cv_vault_items WHERE item_id = ? AND item_owner_id = ? AND item_trashed = 1",
    [req.params.id, uid]
  );

  if (!rows.length) return res.status(404).json({ success: false, error: "Not in trash" });

  await blogQuery(
    "UPDATE cv_vault_items SET item_trashed = 0, item_trashed_at = NULL WHERE item_id = ?",
    [rows[0].item_id]
  );

  await cvLogActivity(uid, "restore", rows[0].item_name, req.ip, rows[0].item_id);
  res.json({ success: true, message: "Restored" });
}));

// ═══════════════════════════════════════════════════════════
// 💀 16) PURGE → DELETE /api/files/:id/purge
// ═══════════════════════════════════════════════════════════
router.delete("/:id/purge", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;
  await purgeRecursive(req.params.id, uid);
  await cvLogActivity(uid, "purge", req.params.id, req.ip);
  res.json({ success: true, message: "Permanently deleted" });
}));

async function purgeRecursive(id, uid) {
  const rows = await blogQuery(
    "SELECT * FROM cv_vault_items WHERE item_id = ? AND item_owner_id = ?",
    [id, uid]
  );
  if (!rows.length) return;

  const f = rows[0];

  if (f.item_is_folder) {
    const children = await blogQuery(
      "SELECT item_id FROM cv_vault_items WHERE item_parent_id = ?",
      [f.item_id]
    );
    for (const c of children) await purgeRecursive(c.item_id, uid);
  } else if (f.item_public_id) {
    try {
      await cloudinary.uploader.destroy(f.item_public_id, {
        resource_type: f.item_resource_type || "raw"
      });
    } catch (e) {
      console.warn("Cloudinary destroy:", e.message);
    }
  }

  // Delete versions
  const versions = await blogQuery(
    "SELECT ver_public_id FROM cv_file_history WHERE ver_item_id = ?",
    [f.item_id]
  );
  for (const v of versions) {
    if (v.ver_public_id) {
      await deleteBlogFromCloudinary(v.ver_public_id).catch(() => {});
    }
  }

  await blogQuery("DELETE FROM cv_vault_items WHERE item_id = ?", [f.item_id]);
}

// ═══════════════════════════════════════════════════════════
// 🧹 17) EMPTY TRASH → DELETE /api/files/trash/empty
// ═══════════════════════════════════════════════════════════
router.delete("/trash/empty", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const rows = await blogQuery(
    "SELECT item_id FROM cv_vault_items WHERE item_owner_id = ? AND item_trashed = 1",
    [uid]
  );

  let purged = 0;
  for (const r of rows) {
    try {
      await purgeRecursive(r.item_id, uid);
      purged++;
    } catch {}
  }

  await cvLogActivity(uid, "empty_trash", `${purged} items`, req.ip);
  res.json({ success: true, purged });
}));

// ═══════════════════════════════════════════════════════════
// 📦 18) BULK ACTION → POST /api/files/bulk
// ═══════════════════════════════════════════════════════════
router.post("/bulk", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;
  const { ids = [], action, parent_id = null } = req.body;

  if (!ids.length || !action)
    return res.status(400).json({ success: false, error: "ids and action required" });

  let affected = 0;

  for (const id of ids) {
    try {
      if (action === "trash") {
        await blogQuery(
          "UPDATE cv_vault_items SET item_trashed = 1, item_trashed_at = NOW() WHERE item_id = ? AND item_owner_id = ?",
          [id, uid]
        );
        affected++;
      } else if (action === "restore") {
        await blogQuery(
          "UPDATE cv_vault_items SET item_trashed = 0, item_trashed_at = NULL WHERE item_id = ? AND item_owner_id = ?",
          [id, uid]
        );
        affected++;
      } else if (action === "purge") {
        await purgeRecursive(id, uid);
        affected++;
      } else if (action === "star") {
        await blogQuery(
          "UPDATE cv_vault_items SET item_starred = 1 WHERE item_id = ? AND item_owner_id = ?",
          [id, uid]
        );
        affected++;
      } else if (action === "unstar") {
        await blogQuery(
          "UPDATE cv_vault_items SET item_starred = 0 WHERE item_id = ? AND item_owner_id = ?",
          [id, uid]
        );
        affected++;
      } else if (action === "move") {
        await blogQuery(
          "UPDATE cv_vault_items SET item_parent_id = ? WHERE item_id = ? AND item_owner_id = ?",
          [parent_id, id, uid]
        );
        affected++;
      }
    } catch (e) {
      console.warn(`Bulk ${action} failed for ${id}:`, e.message);
    }
  }

  await cvLogActivity(uid, `bulk_${action}`, `${affected} items`, req.ip);
  res.json({ success: true, affected });
}));

// ═══════════════════════════════════════════════════════════
// ℹ️ 19) FILE INFO → GET /api/files/:id/info
// ═══════════════════════════════════════════════════════════
router.get("/:id/info", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const rows = await blogQuery(
    `SELECT 
      item_id AS id, item_name AS name, item_original_name AS original_name,
      item_size AS file_size, item_mime AS mime_type, item_ext AS extension,
      item_category AS category, item_cloud_url AS cloud_url, item_public_id AS public_id,
      item_resource_type AS resource_type, item_is_folder AS is_folder,
      item_parent_id AS parent_id, item_starred AS starred, item_trashed AS trashed,
      item_trashed_at AS trashed_at, item_download_count AS download_count,
      item_created_at AS created_at, item_updated_at AS updated_at
     FROM cv_vault_items WHERE item_id = ? AND item_owner_id = ?`,
    [req.params.id, uid]
  );

  if (!rows.length) return res.status(404).json({ success: false, error: "Not found" });

  const file = rows[0];
  file.file_size_formatted = fmtSize(file.file_size);
  file.time_ago = timeAgo(file.created_at);
  file.created_at_formatted = formatDelhi(parseDelhiDate(file.created_at), "full");

  res.json({ success: true, file });
}));

// ═══════════════════════════════════════════════════════════
// 🕒 20) RECENT FILES → GET /api/files/recent/list
// ═══════════════════════════════════════════════════════════
router.get("/recent/list", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const rows = await blogQuery(
    `SELECT 
      item_id AS id, item_name AS name, item_size AS file_size,
      item_mime AS mime_type, item_ext AS extension, item_category AS category,
      item_is_folder AS is_folder, item_cloud_url AS cloud_url, item_created_at AS created_at
     FROM cv_vault_items
     WHERE item_owner_id = ? AND item_trashed = 0
     ORDER BY item_created_at DESC LIMIT 20`,
    [uid]
  );

  rows.forEach(f => { f.time_ago = timeAgo(f.created_at); });
  res.json({ success: true, files: rows || [] });
}));

// ═══════════════════════════════════════════════════════════
// 🔍 21) SEARCH → GET /api/files/search?q=
// ═══════════════════════════════════════════════════════════
router.get("/search", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;
  const q = `%${req.query.q || ""}%`;

  const rows = await blogQuery(
    `SELECT 
      item_id AS id, item_name AS name, item_size AS file_size,
      item_mime AS mime_type, item_ext AS extension, item_category AS category,
      item_is_folder AS is_folder, item_cloud_url AS cloud_url, item_created_at AS created_at
     FROM cv_vault_items
     WHERE item_owner_id = ? AND item_trashed = 0 
       AND (item_name LIKE ? OR item_original_name LIKE ?)
     ORDER BY item_created_at DESC LIMIT 100`,
    [uid, q, q]
  );

  rows.forEach(f => { f.time_ago = timeAgo(f.created_at); });
  res.json({ success: true, files: rows || [] });
}));

// ═══════════════════════════════════════════════════════════
// 📊 22) STORAGE STATS → GET /api/files/stats/info
// ═══════════════════════════════════════════════════════════
router.get("/stats/info", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const statsRows = await blogQuery(
    `SELECT 
       COUNT(CASE WHEN item_is_folder = 0 AND item_trashed = 0 THEN 1 END) AS totalFiles,
       COUNT(CASE WHEN item_is_folder = 1 AND item_trashed = 0 THEN 1 END) AS totalFolders,
       COUNT(CASE WHEN item_trashed = 1 THEN 1 END) AS trashItems,
       COALESCE(SUM(CASE WHEN item_is_folder = 0 AND item_trashed = 0 THEN item_size ELSE 0 END), 0) AS used_bytes,
       COALESCE(SUM(item_download_count), 0) AS totalDownloads
     FROM cv_vault_items WHERE item_owner_id = ?`,
    [uid]
  );
  const stats = statsRows[0] || {};

  const byCategory = await blogQuery(
    `SELECT item_category AS category, COUNT(*) AS count, COALESCE(SUM(item_size),0) AS size
     FROM cv_vault_items 
     WHERE item_owner_id = ? AND item_is_folder = 0 AND item_trashed = 0
     GROUP BY item_category`,
    [uid]
  );

  const recentActivity = await blogQuery(
    `SELECT log_id AS id, log_action AS action, log_target AS target,
            log_created_at AS created_at
     FROM cv_audit_trail WHERE log_user_id = ?
     ORDER BY log_created_at DESC LIMIT 5`,
    [uid]
  );

  res.json({
    success: true,
    stats: {
      totalFiles: stats.totalFiles || 0,
      totalFolders: stats.totalFolders || 0,
      trashItems: stats.trashItems || 0,
      totalDownloads: stats.totalDownloads || 0,
      storageUsed: stats.used_bytes || 0,
      storageUsedFormatted: fmtSize(stats.used_bytes || 0),
      storageMax: MAX_STORAGE_BYTES,
      storageMaxFormatted: fmtSize(MAX_STORAGE_BYTES),
      storagePercent: (((stats.used_bytes || 0) / MAX_STORAGE_BYTES) * 100).toFixed(1),
      byCategory: byCategory || [],
      recentActivity: recentActivity || []
    }
  });
}));

// ═══════════════════════════════════════════════════════════
// 📝 23) UPLOAD NEW VERSION → POST /api/files/:id/version
// ═══════════════════════════════════════════════════════════
router.post("/:id/version", cvAuthRequired, uploadBlogFile.single("file"),
  cvAsync(async (req, res) => {
    const uid = req.user.id;

    if (!req.file)
      return res.status(400).json({ success: false, error: "Field 'file' required" });

    const rows = await blogQuery(
      "SELECT * FROM cv_vault_items WHERE item_id = ? AND item_owner_id = ? AND item_is_folder = 0",
      [req.params.id, uid]
    );

    if (!rows.length) return res.status(404).json({ success: false, error: "Not found" });

    const old = rows[0];

    // Get max version number
    const maxVRows = await blogQuery(
      "SELECT COALESCE(MAX(ver_number),0) AS m FROM cv_file_history WHERE ver_item_id = ?",
      [old.item_id]
    );
    const maxV = maxVRows[0]?.m || 0;

    // Save current as version
    await blogQuery(
      `INSERT INTO cv_file_history 
       (ver_item_id, ver_number, ver_cloud_url, ver_public_id, ver_size, ver_created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [old.item_id, maxV + 1, old.item_cloud_url, old.item_public_id, old.item_size, uid]
    );

    const ext = path.extname(req.file.originalname || "").replace(".", "").toLowerCase();

    await blogQuery(
      `UPDATE cv_vault_items 
       SET item_cloud_url = ?, item_public_id = ?, item_size = ?, item_mime = ?, item_ext = ?
       WHERE item_id = ?`,
      [req.file.path, req.file.filename, req.file.size || 0,
       req.file.mimetype, ext, old.item_id]
    );

    await cvLogActivity(uid, "version_upload", old.item_name, req.ip, old.item_id);
    res.json({ success: true, version: maxV + 1, url: req.file.path });
  })
);

// ═══════════════════════════════════════════════════════════
// 📜 24) LIST VERSIONS → GET /api/files/:id/versions
// ═══════════════════════════════════════════════════════════
router.get("/:id/versions", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const check = await blogQuery(
    "SELECT item_id FROM cv_vault_items WHERE item_id = ? AND item_owner_id = ?",
    [req.params.id, uid]
  );
  if (!check.length) return res.status(404).json({ success: false, error: "Not found" });

  const versions = await blogQuery(
    `SELECT ver_id AS id, ver_number AS version_no, ver_cloud_url AS cloud_url,
            ver_public_id AS public_id, ver_size AS size, ver_created_at AS created_at
     FROM cv_file_history WHERE ver_item_id = ? ORDER BY ver_number DESC`,
    [req.params.id]
  );

  versions.forEach(v => {
    v.time_ago = timeAgo(v.created_at);
    v.size_formatted = fmtSize(v.size);
  });

  res.json({ success: true, versions });
}));

// ═══════════════════════════════════════════════════════════
// 📋 25) ACTIVITY LOG → GET /api/files/activity/log
// ═══════════════════════════════════════════════════════════
router.get("/activity/log", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  const logs = await blogQuery(
    `SELECT log_id AS id, log_action AS action, log_target AS target,
            log_item_id AS item_id, log_ip AS ip, log_created_at AS created_at
     FROM cv_audit_trail WHERE log_user_id = ?
     ORDER BY log_created_at DESC LIMIT ?`,
    [uid, limit]
  );

  logs.forEach(l => {
    l.time_ago = timeAgo(l.created_at);
    l.created_at_formatted = formatDelhi(parseDelhiDate(l.created_at), "full");
  });

  res.json({ success: true, logs });
}));

// ═══════════════════════════════════════════════════════════
// 🔔 26) ALERTS / NOTIFICATIONS → GET /api/files/alerts
// ═══════════════════════════════════════════════════════════
router.get("/alerts/list", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const alerts = await blogQuery(
    `SELECT alert_id AS id, alert_type AS type, alert_title AS title,
            alert_message AS message, alert_link AS link, alert_is_read AS is_read,
            alert_created_at AS created_at
     FROM cv_alerts WHERE alert_user_id = ?
     ORDER BY alert_created_at DESC LIMIT 50`,
    [uid]
  );

  alerts.forEach(a => { a.time_ago = timeAgo(a.created_at); });

  const unread = await blogQuery(
    "SELECT COUNT(*) AS count FROM cv_alerts WHERE alert_user_id = ? AND alert_is_read = 0",
    [uid]
  );

  res.json({ success: true, alerts, unread_count: unread[0].count });
}));

router.put("/alerts/:id/read", cvAuthRequired, cvAsync(async (req, res) => {
  await blogQuery(
    "UPDATE cv_alerts SET alert_is_read = 1 WHERE alert_id = ? AND alert_user_id = ?",
    [req.params.id, req.user.id]
  );
  res.json({ success: true });
}));

router.put("/alerts/read-all", cvAuthRequired, cvAsync(async (req, res) => {
  await blogQuery(
    "UPDATE cv_alerts SET alert_is_read = 1 WHERE alert_user_id = ?",
    [req.user.id]
  );
  res.json({ success: true });
}));

router.delete("/alerts/:id", cvAuthRequired, cvAsync(async (req, res) => {
  await blogQuery(
    "DELETE FROM cv_alerts WHERE alert_id = ? AND alert_user_id = ?",
    [req.params.id, req.user.id]
  );
  res.json({ success: true });
}));

// ═══════════════════════════════════════════════════════════
// ⚙️ 27) PREFERENCES → GET / PUT /api/files/preferences
// ═══════════════════════════════════════════════════════════
router.get("/preferences/info", cvAuthRequired, cvAsync(async (req, res) => {
  const rows = await blogQuery(
    `SELECT pref_theme AS theme, pref_default_view AS default_view,
            pref_default_sort AS default_sort, pref_language AS language,
            pref_notifications AS notifications, pref_auto_backup AS auto_backup
     FROM cv_preferences WHERE pref_user_id = ?`,
    [req.user.id]
  );

  if (!rows.length) {
    return res.json({
      success: true,
      preferences: {
        theme: "light",
        default_view: "grid",
        default_sort: "date-desc",
        language: "en",
        notifications: 1,
        auto_backup: 0
      }
    });
  }

  res.json({ success: true, preferences: rows[0] });
}));

router.put("/preferences/info", cvAuthRequired, cvAsync(async (req, res) => {
  const { theme, default_view, default_sort, language, notifications, auto_backup } = req.body;

  const existing = await blogQuery(
    "SELECT pref_id FROM cv_preferences WHERE pref_user_id = ?",
    [req.user.id]
  );

  if (existing.length) {
    const updates = [];
    const params = [];
    if (theme !== undefined) { updates.push("pref_theme = ?"); params.push(theme); }
    if (default_view !== undefined) { updates.push("pref_default_view = ?"); params.push(default_view); }
    if (default_sort !== undefined) { updates.push("pref_default_sort = ?"); params.push(default_sort); }
    if (language !== undefined) { updates.push("pref_language = ?"); params.push(language); }
    if (notifications !== undefined) { updates.push("pref_notifications = ?"); params.push(notifications ? 1 : 0); }
    if (auto_backup !== undefined) { updates.push("pref_auto_backup = ?"); params.push(auto_backup ? 1 : 0); }

    if (updates.length) {
      params.push(req.user.id);
      await blogQuery(`UPDATE cv_preferences SET ${updates.join(", ")} WHERE pref_user_id = ?`, params);
    }
  } else {
    await blogQuery(
      `INSERT INTO cv_preferences 
       (pref_user_id, pref_theme, pref_default_view, pref_default_sort, pref_language, pref_notifications, pref_auto_backup)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        theme || "light",
        default_view || "grid",
        default_sort || "date-desc",
        language || "en",
        notifications ? 1 : 0,
        auto_backup ? 1 : 0
      ]
    );
  }

  res.json({ success: true, message: "Preferences saved" });
}));

// ═══════════════════════════════════════════════════════════
// 📁 28) FOLDER TREE → GET /api/files/folders/tree
// ═══════════════════════════════════════════════════════════
router.get("/folders/tree", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const folders = await blogQuery(
    `SELECT item_id AS id, item_name AS name, item_parent_id AS parent_id
     FROM cv_vault_items
     WHERE item_owner_id = ? AND item_is_folder = 1 AND item_trashed = 0
     ORDER BY item_name ASC`,
    [uid]
  );

  // Build tree
  const map = {};
  const tree = [];

  folders.forEach(f => {
    map[f.id] = { ...f, children: [] };
  });

  folders.forEach(f => {
    if (f.parent_id && map[f.parent_id]) {
      map[f.parent_id].children.push(map[f.id]);
    } else {
      tree.push(map[f.id]);
    }
  });

  res.json({ success: true, tree });
}));

// ═══════════════════════════════════════════════════════════
// 🔗 29) SHARE LINK → POST /api/files/:id/share
// ═══════════════════════════════════════════════════════════
router.post("/:id/share", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;
  const { expiresInHours = 24, password } = req.body;

  const rows = await blogQuery(
    "SELECT * FROM cv_vault_items WHERE item_id = ? AND item_owner_id = ? AND item_is_folder = 0",
    [req.params.id, uid]
  );

  if (!rows.length) return res.status(404).json({ success: false, error: "Not found" });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = expiresInHours > 0
    ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
    : null;

  let passwordHash = null;
  if (password) passwordHash = await bcrypt.hash(password, 10);

  await blogQuery(
    `INSERT INTO cv_share_links 
     (share_item_id, share_owner_id, share_token, share_password, share_expires_at, share_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [rows[0].item_id, uid, token, passwordHash, expiresAt]
  );

  await cvLogActivity(uid, "share", rows[0].item_name, req.ip, rows[0].item_id);

  const baseUrl = process.env.SITE_URL || "https://gsssshilla.onrender.com";
  res.json({
    success: true,
    token,
    shareUrl: `${baseUrl}/api/files/shared/${token}`,
    expiresAt,
    hasPassword: !!password
  });
}));

// ═══════════════════════════════════════════════════════════
// 🔗 30) ACCESS SHARED FILE → GET /api/files/shared/:token
// ═══════════════════════════════════════════════════════════
router.get("/shared/:token", cvAsync(async (req, res) => {
  const rows = await blogQuery(
    `SELECT s.*, v.item_name, v.item_cloud_url, v.item_size, v.item_mime, v.item_ext
     FROM cv_share_links s
     JOIN cv_vault_items v ON v.item_id = s.share_item_id
     WHERE s.share_token = ? AND s.share_active = 1`,
    [req.params.token]
  );

  if (!rows.length) return res.status(404).json({ success: false, error: "Share link not found" });

  const share = rows[0];

  // Check expiry
  if (share.share_expires_at && new Date(share.share_expires_at) < new Date()) {
    return res.status(410).json({ success: false, error: "Share link expired" });
  }

  // Check max downloads
  if (share.share_max_downloads && share.share_download_count >= share.share_max_downloads) {
    return res.status(410).json({ success: false, error: "Download limit reached" });
  }

  // Increment download count
  await blogQuery(
    "UPDATE cv_share_links SET share_download_count = share_download_count + 1 WHERE share_id = ?",
    [share.share_id]
  );

  const downloadUrl = share.item_cloud_url?.includes("/upload/")
    ? share.item_cloud_url.replace("/upload/", "/upload/fl_attachment/")
    : share.item_cloud_url;

  res.redirect(downloadUrl);
}));

// ═══════════════════════════════════════════════════════════
// 🔗 31) MY SHARES → GET /api/files/shares/list
// ═══════════════════════════════════════════════════════════
router.get("/shares/list", cvAuthRequired, cvAsync(async (req, res) => {
  const uid = req.user.id;

  const shares = await blogQuery(
    `SELECT s.share_id AS id, s.share_token AS token, s.share_expires_at AS expires_at,
            s.share_download_count AS download_count, s.share_active AS active,
            s.share_created_at AS created_at,
            v.item_id AS file_id, v.item_name AS file_name, v.item_size AS file_size
     FROM cv_share_links s
     JOIN cv_vault_items v ON v.item_id = s.share_item_id
     WHERE s.share_owner_id = ?
     ORDER BY s.share_created_at DESC`,
    [uid]
  );

  shares.forEach(s => {
    s.time_ago = timeAgo(s.created_at);
    s.is_expired = s.expires_at && new Date(s.expires_at) < new Date();
  });

  res.json({ success: true, shares });
}));

// ═══════════════════════════════════════════════════════════
// 🔗 32) REVOKE SHARE → DELETE /api/files/shares/:id
// ═══════════════════════════════════════════════════════════
router.delete("/shares/:id", cvAuthRequired, cvAsync(async (req, res) => {
  await blogQuery(
    "UPDATE cv_share_links SET share_active = 0 WHERE share_id = ? AND share_owner_id = ?",
    [req.params.id, req.user.id]
  );
  res.json({ success: true, message: "Share revoked" });
}));

// ═══════════════════════════════════════════════════════════
// 🧹 AUTO-CLEAN TRASH (helper — server.js se call karo)
// ═══════════════════════════════════════════════════════════
const autoCleanTrash = async () => {
  try {
    const rows = await blogQuery(
      `SELECT item_id, item_owner_id FROM cv_vault_items
       WHERE item_trashed = 1 
         AND item_trashed_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [TRASH_RETENTION_DAYS]
    );

    let purged = 0;
    for (const r of rows) {
      try {
        await purgeRecursive(r.item_id, r.item_owner_id);
        purged++;
      } catch (e) {
        console.error("Auto-clean purge error:", e.message);
      }
    }
    console.log(`[AUTO-CLEAN] Purged ${purged} old trash items`);
    return purged;
  } catch (err) {
    console.error("[AUTO-CLEAN ERROR]", err.message);
    return 0;
  }
};

// ═══════════════════════════════════════════════════════════
// ❤️ HEALTH CHECK
// ═══════════════════════════════════════════════════════════
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "files-api",
    time: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
module.exports = router;
module.exports.autoCleanTrash = autoCleanTrash;
