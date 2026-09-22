const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// ═══════════════════════════════════════════════════════════
// IMPORTS
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
// SCHOOL MIDDLEWARE (existing)
// ═══════════════════════════════════════════════════════════
const authRequired = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== "admin")
    return res.status(403).json({ error: "Admin access required" });
  next();
};

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ... existing school routes rahenge yahan ...

// ═══════════════════════════════════════════════════════════
// 🆕 BLOG HELPERS
// ═══════════════════════════════════════════════════════════
const blogSlugify = (text) =>
  text.toString().toLowerCase().trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 200);

const blogAsync = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const calcReadTime = (content) => {
  const words = content.replace(/<[^>]+>/g, "").split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
};

// ═══════════════════════════════════════════════════════════
// ⏰ SMART TIME (Delhi/IST)
// ═══════════════════════════════════════════════════════════
const parseDelhiDate = (dateStr) => {
  if (!dateStr) return null;
  if (typeof dateStr === 'string' && (dateStr.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(dateStr))) {
    return new Date(dateStr);
  }
  if (typeof dateStr === 'string') {
    const normalized = dateStr.replace(' ', 'T');
    return new Date(normalized + '+05:30');
  }
  return new Date(dateStr);
};

const formatDelhi = (date, format = 'full') => {
  if (!date) return '';
  const opts = {
    full: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true },
    date: { day: 'numeric', month: 'short', year: 'numeric' },
    time: { hour: '2-digit', minute: '2-digit', hour12: true }
  };
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    ...opts[format]
  });
};

const timeAgo = (dateStr) => {
  if (!dateStr) return '';
  const then = parseDelhiDate(dateStr);
  if (!then || isNaN(then.getTime())) return '';
  const now = new Date();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 0) return formatDelhi(then, 'full');
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  return formatDelhi(then, 'full');
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = parseDelhiDate(dateStr);
  if (!d || isNaN(d.getTime())) return '';
  return formatDelhi(d, 'date');
};

const readingTime = (c) => {
  if (!c) return '1 min read';
  const w = c.replace(/<[^>]+>/g, '').split(/\s+/).length;
  return Math.max(1, Math.ceil(w / 200)) + ' min read';
};

// ═══════════════════════════════════════════════════════════
// 🛡️ RATE LIMITER (simple in-memory)
// ═══════════════════════════════════════════════════════════
const rateLimitStore = new Map();

const rateLimit = (options = {}) => {
  const {
    windowMs = 60 * 1000,
    max = 30,
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
        error: message,
        retryAfter: Math.ceil((record.resetAt - now) / 1000)
      });
    }
    next();
  };
};

// Cleanup old entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitStore.entries()) {
    if (now > val.resetAt) rateLimitStore.delete(key);
  }
}, 5 * 60 * 1000);

// ═══════════════════════════════════════════════════════════
// 📝 ACTIVITY LOGGER
// ═══════════════════════════════════════════════════════════
const logActivity = async (userId, action, entityType, entityId, details, ip) => {
  try {
    await blogQuery(
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, action, entityType, entityId, JSON.stringify(details || {}), ip]
    );
  } catch (e) {
    console.error("Activity log error:", e.message);
  }
};

// ═══════════════════════════════════════════════════════════
// 🔔 NOTIFICATION HELPER
// ═══════════════════════════════════════════════════════════
const createNotification = async (userId, type, title, message, link) => {
  try {
    await blogQuery(
      `INSERT INTO notifications (user_id, type, title, message, link)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, type, title, message || null, link || null]
    );
  } catch (e) {
    console.error("Notification error:", e.message);
  }
};

// ═══════════════════════════════════════════════════════════
// 🆕 BLOG MIDDLEWARE
// ═══════════════════════════════════════════════════════════
const blogAuthRequired = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
};

const blogOptionalAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return next();
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {}
  next();
};

const blogSuperAdminOnly = (req, res, next) => {
  if (req.user?.role !== "admin")
    return res.status(403).json({ error: "Super Admin access required" });
  next();
};

const blogApprovedOnly = async (req, res, next) => {
  try {
    const rows = await blogQuery("SELECT status FROM users WHERE id = ?", [req.user.id]);
    if (!rows.length || rows[0].status !== "approved")
      return res.status(403).json({ error: "Account pending approval" });
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const blogAuthorOrAdmin = async (req, res, next) => {
  try {
    const rows = await blogQuery(
      "SELECT role, role_type, status FROM users WHERE id = ?",
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const { role, role_type, status } = rows[0];

    if (status !== "approved")
      return res.status(403).json({ error: "Account pending approval" });
    if (role === "admin" || role_type === "author") return next();

    return res.status(403).json({
      error: "Only authors can publish posts. Contact super admin to become an author."
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 🔐 BLOG AUTH
// ═══════════════════════════════════════════════════════════

router.post("/blog/auth/register", rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }),
  blogAsync(async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields required" });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be 6+ characters" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Invalid email format" });

    const existing = await blogQuery("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length) return res.status(409).json({ error: "Email already registered" });

    const hash = await bcrypt.hash(password, 10);
    const result = await blogQuery(
      `INSERT INTO users (name, email, password_hash, role, role_type, status)
       VALUES (?, ?, ?, 'user', 'user', 'pending')`,
      [name, email, hash]
    );

    // Email verification token
    const token = crypto.randomBytes(32).toString("hex");
    await blogQuery(
      `INSERT INTO email_verifications (user_id, token, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
      [result.insertId, token]
    );

    await logActivity(result.insertId, "register", "user", result.insertId, { email }, req.ip);

    res.status(201).json({
      message: "Registration successful! Please wait for super admin approval.",
      user: { id: result.insertId, name, email, status: "pending" },
      verification_url: `/verify-email.html?token=${token}`
    });
  })
);

router.post("/blog/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
  blogAsync(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const rows = await blogQuery("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
    if (!rows.length) return res.status(401).json({ error: "Invalid credentials" });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    if (user.status === "pending")
      return res.status(403).json({ error: "Your account is pending approval by super admin" });
    if (user.status === "rejected")
      return res.status(403).json({ error: "Your account has been rejected" });

    delete user.password_hash;
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    await blogQuery("UPDATE users SET last_login = NOW() WHERE id = ?", [user.id]);

    res.json({ user, token });
  })
);

router.get("/blog/auth/me", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery(
    `SELECT id, name, email, role, role_type, status, bio, avatar_url, 
            website, twitter, linkedin, is_verified, email_verified, created_at
     FROM users WHERE id = ?`,
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: "User not found" });

  const stats = await blogQuery(`
    SELECT 
      (SELECT COUNT(*) FROM posts WHERE author_id = ? AND status = 'published') AS post_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following_count,
      (SELECT COUNT(*) FROM follows WHERE author_id = ?) AS follower_count,
      (SELECT COALESCE(SUM(views),0) FROM posts WHERE author_id = ?) AS total_views
  `, [req.user.id, req.user.id, req.user.id, req.user.id]);

  res.json({ ...rows[0], stats: stats[0] });
}));

router.put("/blog/auth/profile", blogAuthRequired, blogAsync(async (req, res) => {
  const { name, bio, website, twitter, linkedin } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  await blogQuery(
    `UPDATE users SET name = ?, bio = ?, website = ?, twitter = ?, linkedin = ?
     WHERE id = ?`,
    [name, bio || null, website || null, twitter || null, linkedin || null, req.user.id]
  );
  await logActivity(req.user.id, "update_profile", "user", req.user.id, {}, req.ip);
  res.json({ message: "Profile updated" });
}));

router.put("/blog/auth/password", blogAuthRequired, blogAsync(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: "Both passwords required" });
  if (new_password.length < 6)
    return res.status(400).json({ error: "Password must be 6+ characters" });

  const rows = await blogQuery("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!rows.length) return res.status(404).json({ error: "User not found" });

  const valid = await bcrypt.compare(current_password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: "Current password is wrong" });

  const hash = await bcrypt.hash(new_password, 10);
  await blogQuery("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.user.id]);
  res.json({ message: "Password updated" });
}));

router.post("/blog/auth/avatar", blogAuthRequired, uploadBlogAvatar.single("avatar"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const rows = await blogQuery("SELECT avatar_public_id FROM users WHERE id = ?", [req.user.id]);
    if (rows[0]?.avatar_public_id) {
      await deleteBlogFromCloudinary(rows[0].avatar_public_id).catch(() => {});
    }

    await blogQuery(
      "UPDATE users SET avatar_url = ?, avatar_public_id = ? WHERE id = ?",
      [req.file.path, req.file.filename, req.user.id]
    );
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

// ═══════════════════════════════════════════════════════════
// 📧 EMAIL VERIFICATION
// ═══════════════════════════════════════════════════════════

router.post("/blog/auth/verify-email", blogAsync(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Token required" });

  const rows = await blogQuery(
    "SELECT user_id FROM email_verifications WHERE token = ? AND expires_at > NOW()",
    [token]
  );
  if (!rows.length) return res.status(400).json({ error: "Invalid or expired token" });

  await blogQuery(
    "UPDATE users SET email_verified = TRUE, email_verified_at = NOW() WHERE id = ?",
    [rows[0].user_id]
  );
  await blogQuery("DELETE FROM email_verifications WHERE user_id = ?", [rows[0].user_id]);

  res.json({ message: "Email verified successfully" });
}));

router.post("/blog/auth/resend-verification", blogAuthRequired, blogAsync(async (req, res) => {
  const token = crypto.randomBytes(32).toString("hex");
  await blogQuery("DELETE FROM email_verifications WHERE user_id = ?", [req.user.id]);
  await blogQuery(
    `INSERT INTO email_verifications (user_id, token, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
    [req.user.id, token]
  );
  res.json({ message: "Verification email sent", verification_url: `/verify-email.html?token=${token}` });
}));

// ═══════════════════════════════════════════════════════════
// 🔐 FORGOT / RESET PASSWORD
// ═══════════════════════════════════════════════════════════

router.post("/blog/auth/forgot-password", rateLimit({ windowMs: 60 * 60 * 1000, max: 3 }),
  blogAsync(async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const rows = await blogQuery("SELECT id FROM users WHERE email = ?", [email]);
    if (!rows.length) return res.status(404).json({ error: "Email not found" });

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await blogQuery(
      "UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?",
      [token, expires, rows[0].id]
    );

    res.json({
      message: "Reset token generated",
      reset_token: token,
      reset_url: `/reset-password.html?token=${token}`
    });
  })
);

router.post("/blog/auth/reset-password", blogAsync(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password)
    return res.status(400).json({ error: "Token and password required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be 6+ characters" });

  const rows = await blogQuery(
    "SELECT id FROM users WHERE reset_token = ? AND reset_expires > NOW()",
    [token]
  );
  if (!rows.length) return res.status(400).json({ error: "Invalid or expired token" });

  const hash = await bcrypt.hash(password, 10);
  await blogQuery(
    "UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?",
    [hash, rows[0].id]
  );
  res.json({ message: "Password reset successful. Please login." });
}));

// ═══════════════════════════════════════════════════════════
// 📝 BLOG POSTS — Public
// ═══════════════════════════════════════════════════════════

// GET /api/blog/posts — public list
router.get("/blog/posts", blogAsync(async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 9, 50);
  const offset = (page - 1) * limit;
  const { category, tag, author, search, featured, sort } = req.query;

  const where = ["p.status = 'published'", "p.deleted_at IS NULL"];
  const params = [];

  if (category) { where.push("c.slug = ?"); params.push(category); }
  if (author) { where.push("p.author_id = ?"); params.push(author); }
  if (featured === "true") { where.push("p.featured = TRUE"); }
  if (search) {
    where.push("(p.title LIKE ? OR p.excerpt LIKE ? OR p.content LIKE ?)");
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (tag) {
    where.push(`p.id IN (
      SELECT pt.post_id FROM post_tags pt
      JOIN tags t ON t.id = pt.tag_id WHERE t.slug = ?
    )`);
    params.push(tag);
  }

  const whereSQL = "WHERE " + where.join(" AND ");

  let orderBy = "p.published_at DESC, p.id DESC";
  if (sort === "views") orderBy = "p.views DESC, p.published_at DESC";
  if (sort === "popular") orderBy = "like_count DESC, p.views DESC";
  if (sort === "oldest") orderBy = "p.published_at ASC";

  const countRows = await blogQuery(
    `SELECT COUNT(*) AS total FROM posts p
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereSQL}`,
    params
  );
  const total = countRows[0].total;

  const posts = await blogQuery(
    `SELECT p.id, p.title, p.slug, p.excerpt, p.cover_image, p.views,
            p.read_time, p.featured, p.is_pinned, p.published_at, p.created_at,
            u.id AS author_id, u.name AS author_name,
            u.avatar_url AS author_avatar, u.is_verified AS author_verified,
            c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
            c.color AS category_color,
            (SELECT COUNT(*) FROM reactions WHERE post_id = p.id) AS like_count,
            (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND status = 'approved') AS comment_count
     FROM posts p
     JOIN users u ON u.id = p.author_id
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereSQL}
     ORDER BY p.is_pinned DESC, ${orderBy}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  // Add formatted dates
  posts.forEach(p => {
    p.time_ago = timeAgo(p.published_at);
    p.formatted_date = formatDate(p.published_at);
  });

  res.json({
    posts,
    pagination: {
      page, limit, total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    }
  });
}));

// GET /api/blog/posts/featured
router.get("/blog/posts/featured", blogAsync(async (req, res) => {
  const posts = await blogQuery(`
    SELECT p.id, p.title, p.slug, p.excerpt, p.cover_image,
           u.name AS author_name, u.avatar_url AS author_avatar, u.is_verified AS author_verified,
           c.name AS category_name, c.slug AS category_slug, c.color AS category_color
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published' AND p.featured = TRUE AND p.deleted_at IS NULL
    ORDER BY p.published_at DESC LIMIT 5
  `);
  res.json(posts);
}));

// ⭐ TRENDING POSTS
router.get("/blog/posts/trending", blogAsync(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 30);
  const limit = Math.min(parseInt(req.query.limit) || 6, 20);

  const posts = await blogQuery(`
    SELECT p.id, p.title, p.slug, p.cover_image, p.views, p.published_at,
           u.name AS author_name, u.avatar_url AS author_avatar, u.is_verified AS author_verified,
           c.name AS category_name, c.slug AS category_slug, c.color AS category_color,
           (SELECT COUNT(*) FROM reactions WHERE post_id = p.id) AS like_count,
           (SELECT COALESCE(SUM(views), 0) FROM post_analytics 
            WHERE post_id = p.id AND view_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)) AS recent_views
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published' AND p.deleted_at IS NULL
      AND p.published_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    ORDER BY recent_views DESC, p.views DESC
    LIMIT ?
  `, [days, days, limit]);

  posts.forEach(p => { p.time_ago = timeAgo(p.published_at); });
  res.json(posts);
}));

// 🔍 SEARCH SUGGESTIONS (autocomplete)
router.get("/blog/search/suggestions", rateLimit({ windowMs: 60 * 1000, max: 60 }),
  blogAsync(async (req, res) => {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) return res.json([]);

    const search = `%${q}%`;
    const posts = await blogQuery(`
      SELECT id, title, slug FROM posts
      WHERE status = 'published' AND deleted_at IS NULL
        AND (title LIKE ? OR excerpt LIKE ?)
      ORDER BY views DESC LIMIT 5
    `, [search, search]);

    const tags = await blogQuery(`
      SELECT id, name, slug FROM tags WHERE name LIKE ?
      ORDER BY name LIMIT 3
    `, [search]);

    const categories = await blogQuery(`
      SELECT id, name, slug FROM categories WHERE name LIKE ?
      ORDER BY name LIMIT 3
    `, [search]);

    res.json({ posts, tags, categories });
  })
);

// GET /api/blog/posts/id/:id — for editing
router.get("/blog/posts/id/:id", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT p.*, u.name AS author_name, c.name AS category_name
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = ? AND p.deleted_at IS NULL
  `, [req.params.id]);

  if (!rows.length) return res.status(404).json({ error: "Post not found" });
  const post = rows[0];

  if (post.author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized to view this post" });

  const tags = await blogQuery(`
    SELECT t.id, t.name, t.slug FROM tags t
    JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ?
  `, [post.id]);
  post.tags = tags;

  const coauthors = await blogQuery(`
    SELECT u.id, u.name, u.email, u.avatar_url
    FROM post_coauthors pc JOIN users u ON u.id = pc.user_id
    WHERE pc.post_id = ?
  `, [post.id]);
  post.coauthors = coauthors;

  res.json(post);
}));

// GET /api/blog/posts/:slug — public single post
router.get("/blog/posts/:slug", blogOptionalAuth, blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT p.*,
           u.id AS author_id, u.name AS author_name,
           u.bio AS author_bio, u.avatar_url AS author_avatar,
           u.is_verified AS author_verified,
           u.website AS author_website, u.twitter AS author_twitter,
           u.linkedin AS author_linkedin,
           c.id AS category_id, c.name AS category_name,
           c.slug AS category_slug, c.color AS category_color,
           (SELECT COUNT(*) FROM reactions WHERE post_id = p.id) AS like_count,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND status = 'approved') AS comment_count
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.slug = ? AND p.status = 'published' AND p.deleted_at IS NULL
  `, [req.params.slug]);

  if (!rows.length) return res.status(404).json({ error: "Post not found" });
  const post = rows[0];

  // ⭐ VIEW TRACKING (unique per device)
  const deviceId = req.headers['x-device-id'] || req.query.device_id;
  blogQuery("UPDATE posts SET views = views + 1 WHERE id = ?", [post.id]).catch(() => {});

  if (deviceId) {
    (async () => {
      try {
        const inserted = await blogQuery(
          "INSERT IGNORE INTO post_unique_views (post_id, device_id) VALUES (?, ?)",
          [post.id, deviceId]
        );
        if (inserted.affectedRows > 0) {
          await blogQuery("UPDATE posts SET unique_views = unique_views + 1 WHERE id = ?", [post.id]);
        }
      } catch {}
    })();
  }

  // Daily analytics
  (async () => {
    try {
      await blogQuery(`
        INSERT INTO post_analytics (post_id, view_date, views, unique_views)
        VALUES (?, CURDATE(), 1, 0)
        ON DUPLICATE KEY UPDATE views = views + 1
      `, [post.id]);
    } catch {}
  })();

  // Reading history (if logged in)
  if (req.user) {
    blogQuery(
      "INSERT INTO reading_history (user_id, post_id, device_id) VALUES (?, ?, ?)",
      [req.user.id, post.id, deviceId || null]
    ).catch(() => {});
  }

  // Tags
  const tags = await blogQuery(`
    SELECT t.id, t.name, t.slug FROM tags t
    JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ?
  `, [post.id]);
  post.tags = tags;

  // Co-authors
  const coauthors = await blogQuery(`
    SELECT u.id, u.name, u.avatar_url, u.is_verified
    FROM post_coauthors pc JOIN users u ON u.id = pc.user_id
    WHERE pc.post_id = ?
  `, [post.id]);
  post.coauthors = coauthors;

  // Related posts (by category + tags)
  const related = await blogQuery(`
    SELECT DISTINCT p.id, p.title, p.slug, p.cover_image, p.published_at, p.read_time,
           u.name AS author_name, u.avatar_url AS author_avatar
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN post_tags pt ON pt.post_id = p.id
    WHERE p.id != ? AND p.status = 'published' AND p.deleted_at IS NULL
      AND (p.category_id = ? OR pt.tag_id IN (
        SELECT tag_id FROM post_tags WHERE post_id = ?
      ))
    ORDER BY p.published_at DESC
    LIMIT 3
  `, [post.id, post.category_id, post.id]);
  post.related = related;

  // Series info
  if (post.series_id) {
    const seriesPosts = await blogQuery(`
      SELECT id, title, slug, series_order FROM posts
      WHERE series_id = ? AND status = 'published' AND deleted_at IS NULL
      ORDER BY series_order ASC
    `, [post.series_id]);
    post.series_posts = seriesPosts;
  }

  post.time_ago = timeAgo(post.published_at);
  post.formatted_date = formatDate(post.published_at);

  res.json(post);
}));

// 🕒 SCHEDULED POSTS AUTO-PUBLISH (helper — call from cron or startup)
const publishScheduledPosts = async () => {
  try {
    await blogQuery(`
      UPDATE posts SET status = 'published', published_at = NOW()
      WHERE status = 'scheduled' AND scheduled_at <= NOW()
    `);
  } catch (e) {
    console.error("Scheduled publish error:", e.message);
  }
};

// Run every minute
setInterval(publishScheduledPosts, 60 * 1000);

// POST /api/blog/posts — create
router.post("/blog/posts", blogAuthRequired, blogAuthorOrAdmin, blogAsync(async (req, res) => {
  const {
    title, excerpt, content, cover_image, cover_public_id,
    category_id, status = "draft", featured = false,
    meta_title, meta_description, tags = [],
    scheduled_at, canonical_url, og_image, series_id, series_order,
    coauthor_ids = []
  } = req.body;

  if (!title || !content)
    return res.status(400).json({ error: "Title and content required" });

  let slug = blogSlugify(title);
  const existing = await blogQuery("SELECT id FROM posts WHERE slug = ?", [slug]);
  if (existing.length) slug = `${slug}-${Date.now()}`;

  let published_at = null;
  let finalStatus = status;

  if (status === "published") {
    published_at = new Date();
  } else if (status === "scheduled" && scheduled_at) {
    finalStatus = "scheduled";
  }

  const read_time = calcReadTime(content);

  const result = await blogQuery(
    `INSERT INTO posts
     (title, slug, excerpt, content, cover_image, cover_public_id,
      author_id, category_id, status, featured, read_time,
      meta_title, meta_description, published_at, scheduled_at,
      canonical_url, og_image, series_id, series_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title, slug, excerpt || null, content, cover_image || null,
      cover_public_id || null, req.user.id, category_id || null,
      finalStatus, featured ? 1 : 0, read_time,
      meta_title || null, meta_description || null, published_at,
      scheduled_at || null, canonical_url || null, og_image || null,
      series_id || null, series_order || 0
    ]
  );

  // Tags
  if (Array.isArray(tags) && tags.length) {
    for (const tagName of tags) {
      const trimmed = String(tagName).trim();
      if (!trimmed) continue;
      const tagSlug = blogSlugify(trimmed);
      await blogQuery("INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)", [trimmed, tagSlug]);
      const tagRows = await blogQuery("SELECT id FROM tags WHERE slug = ?", [tagSlug]);
      if (tagRows.length) {
        await blogQuery(
          "INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
          [result.insertId, tagRows[0].id]
        );
      }
    }
  }

  // Co-authors
  if (Array.isArray(coauthor_ids) && coauthor_ids.length) {
    for (const cid of coauthor_ids) {
      await blogQuery(
        "INSERT IGNORE INTO post_coauthors (post_id, user_id) VALUES (?, ?)",
        [result.insertId, cid]
      ).catch(() => {});
    }
  }

  await logActivity(req.user.id, "create_post", "post", result.insertId,
    { title, status: finalStatus }, req.ip);

  res.status(201).json({ id: result.insertId, slug, message: "Post created" });
}));

// PUT /api/blog/posts/:id — update
router.put("/blog/posts/:id", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery("SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Post not found" });
  const post = rows[0];

  if (post.author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized to edit this post" });

  const {
    title, excerpt, content, cover_image, cover_public_id,
    category_id, status, featured, meta_title, meta_description,
    tags = [], scheduled_at, canonical_url, og_image,
    series_id, series_order, coauthor_ids = []
  } = req.body;

  if (!title || !content)
    return res.status(400).json({ error: "Title and content required" });

  // Save revision before update
  await blogQuery(
    `INSERT INTO post_revisions (post_id, title, content, excerpt, edited_by)
     VALUES (?, ?, ?, ?, ?)`,
    [post.id, post.title, post.content, post.excerpt, req.user.id]
  ).catch(() => {});

  // Cleanup old revisions (keep 10)
  blogQuery(`
    DELETE FROM post_revisions WHERE post_id = ? AND id NOT IN (
      SELECT id FROM (
        SELECT id FROM post_revisions WHERE post_id = ?
        ORDER BY created_at DESC LIMIT 10
      ) AS t
    )
  `, [post.id, post.id]).catch(() => {});

  if (post.cover_public_id && cover_public_id && post.cover_public_id !== cover_public_id) {
    await deleteBlogFromCloudinary(post.cover_public_id).catch(() => {});
  }

  let published_at = post.published_at;
  let finalStatus = status || post.status;

  if (status === "published" && !published_at) {
    published_at = new Date();
  } else if (status === "scheduled") {
    finalStatus = "scheduled";
  }

  const read_time = calcReadTime(content);

  await blogQuery(
    `UPDATE posts SET
       title = ?, excerpt = ?, content = ?, cover_image = ?, cover_public_id = ?,
       category_id = ?, status = ?, featured = ?, read_time = ?,
       meta_title = ?, meta_description = ?, published_at = ?, scheduled_at = ?,
       canonical_url = ?, og_image = ?, series_id = ?, series_order = ?
     WHERE id = ?`,
    [
      title, excerpt || null, content, cover_image || null, cover_public_id || null,
      category_id || null, finalStatus, featured ? 1 : 0, read_time,
      meta_title || null, meta_description || null, published_at,
      scheduled_at || null, canonical_url || null, og_image || null,
      series_id || null, series_order || 0,
      req.params.id
    ]
  );

  await blogQuery("DELETE FROM post_tags WHERE post_id = ?", [req.params.id]);
  if (Array.isArray(tags) && tags.length) {
    for (const tagName of tags) {
      const trimmed = String(tagName).trim();
      if (!trimmed) continue;
      const tagSlug = blogSlugify(trimmed);
      await blogQuery("INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)", [trimmed, tagSlug]);
      const tagRows = await blogQuery("SELECT id FROM tags WHERE slug = ?", [tagSlug]);
      if (tagRows.length) {
        await blogQuery(
          "INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
          [req.params.id, tagRows[0].id]
        );
      }
    }
  }

  // Co-authors
  await blogQuery("DELETE FROM post_coauthors WHERE post_id = ?", [req.params.id]);
  if (Array.isArray(coauthor_ids) && coauthor_ids.length) {
    for (const cid of coauthor_ids) {
      await blogQuery(
        "INSERT IGNORE INTO post_coauthors (post_id, user_id) VALUES (?, ?)",
        [req.params.id, cid]
      ).catch(() => {});
    }
  }

  await logActivity(req.user.id, "update_post", "post", req.params.id, { status: finalStatus }, req.ip);

  res.json({ message: "Post updated successfully", status: finalStatus });
}));

// DELETE /api/blog/posts/:id — soft delete
router.delete("/blog/posts/:id", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery("SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Post not found" });
  const post = rows[0];

  if (post.author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized to delete this post" });

  await blogQuery("UPDATE posts SET deleted_at = NOW(), status = 'archived' WHERE id = ?", [req.params.id]);

  await logActivity(req.user.id, "delete_post", "post", req.params.id, { title: post.title }, req.ip);
  res.json({ message: "Post moved to trash" });
}));

// RESTORE from trash
router.post("/blog/posts/:id/restore", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery("SELECT * FROM posts WHERE id = ? AND deleted_at IS NOT NULL", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Post not found in trash" });

  if (rows[0].author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized" });

  await blogQuery("UPDATE posts SET deleted_at = NULL, status = 'draft' WHERE id = ?", [req.params.id]);
  res.json({ message: "Post restored" });
}));

// PERMANENT delete
router.delete("/blog/posts/:id/permanent", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Post not found" });

  if (rows[0].author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized" });

  if (rows[0].cover_public_id) {
    await deleteBlogFromCloudinary(rows[0].cover_public_id).catch(() => {});
  }

  await blogQuery("DELETE FROM posts WHERE id = ?", [req.params.id]);
  res.json({ message: "Post permanently deleted" });
}));

// 📜 Get post revisions
router.get("/blog/posts/:id/revisions", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Post not found" });

  if (rows[0].author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized" });

  const revisions = await blogQuery(`
    SELECT pr.id, pr.title, pr.excerpt, pr.created_at,
           u.name AS edited_by_name
    FROM post_revisions pr
    LEFT JOIN users u ON u.id = pr.edited_by
    WHERE pr.post_id = ?
    ORDER BY pr.created_at DESC LIMIT 10
  `, [req.params.id]);

  res.json(revisions);
}));

// Restore a revision
router.post("/blog/posts/:id/revisions/:revId/restore", blogAuthRequired, blogAsync(async (req, res) => {
  const post = await blogQuery("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!post.length) return res.status(404).json({ error: "Post not found" });

  if (post[0].author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized" });

  const rev = await blogQuery("SELECT * FROM post_revisions WHERE id = ? AND post_id = ?",
    [req.params.revId, req.params.id]);
  if (!rev.length) return res.status(404).json({ error: "Revision not found" });

  // Save current as revision first
  await blogQuery(
    `INSERT INTO post_revisions (post_id, title, content, excerpt, edited_by)
     VALUES (?, ?, ?, ?, ?)`,
    [post[0].id, post[0].title, post[0].content, post[0].excerpt, req.user.id]
  ).catch(() => {});

  await blogQuery("UPDATE posts SET title = ?, content = ?, excerpt = ? WHERE id = ?",
    [rev[0].title, rev[0].content, rev[0].excerpt, req.params.id]);

  res.json({ message: "Revision restored" });
}));

// ═══════════════════════════════════════════════════════════
// 📌 BOOKMARKS / SAVE FOR LATER
// ═══════════════════════════════════════════════════════════

router.post("/blog/posts/:postId/bookmark", blogAuthRequired, blogAsync(async (req, res) => {
  const existing = await blogQuery(
    "SELECT id FROM bookmarks WHERE user_id = ? AND post_id = ?",
    [req.user.id, req.params.postId]
  );

  if (existing.length) {
    await blogQuery("DELETE FROM bookmarks WHERE id = ?", [existing[0].id]);
    return res.json({ bookmarked: false, message: "Bookmark removed" });
  }

  await blogQuery(
    "INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)",
    [req.user.id, req.params.postId]
  );
  res.json({ bookmarked: true, message: "Post bookmarked" });
}));

router.get("/blog/bookmarks", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT p.id, p.title, p.slug, p.cover_image, p.read_time, p.published_at,
           u.name AS author_name, u.avatar_url AS author_avatar,
           c.name AS category_name, c.color AS category_color,
           b.created_at AS bookmarked_at
    FROM bookmarks b
    JOIN posts p ON p.id = b.post_id
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE b.user_id = ? AND p.status = 'published' AND p.deleted_at IS NULL
    ORDER BY b.created_at DESC
  `, [req.user.id]);

  rows.forEach(r => {
    r.time_ago = timeAgo(r.published_at);
    r.formatted_date = formatDate(r.published_at);
  });
  res.json(rows);
}));

router.get("/blog/posts/:postId/bookmark-status", blogOptionalAuth, blogAsync(async (req, res) => {
  if (!req.user) return res.json({ bookmarked: false });
  const rows = await blogQuery(
    "SELECT id FROM bookmarks WHERE user_id = ? AND post_id = ?",
    [req.user.id, req.params.postId]
  );
  res.json({ bookmarked: rows.length > 0 });
}));

// ═══════════════════════════════════════════════════════════
// 👥 FOLLOW / UNFOLLOW AUTHORS
// ═══════════════════════════════════════════════════════════

router.post("/blog/authors/:authorId/follow", blogAuthRequired, blogAsync(async (req, res) => {
  const authorId = parseInt(req.params.authorId);
  if (authorId === req.user.id)
    return res.status(400).json({ error: "Cannot follow yourself" });

  const author = await blogQuery("SELECT id, name FROM users WHERE id = ? AND status = 'approved'", [authorId]);
  if (!author.length) return res.status(404).json({ error: "Author not found" });

  const existing = await blogQuery(
    "SELECT id FROM follows WHERE follower_id = ? AND author_id = ?",
    [req.user.id, authorId]
  );

  if (existing.length) {
    await blogQuery("DELETE FROM follows WHERE id = ?", [existing[0].id]);
    return res.json({ following: false, message: `Unfollowed ${author[0].name}` });
  }

  await blogQuery(
    "INSERT INTO follows (follower_id, author_id) VALUES (?, ?)",
    [req.user.id, authorId]
  );

  await createNotification(authorId, "follow", "New Follower",
    `Someone started following you`, `/author/${authorId}`);

  res.json({ following: true, message: `Following ${author[0].name}` });
}));

router.get("/blog/authors/:authorId/follow-status", blogOptionalAuth, blogAsync(async (req, res) => {
  if (!req.user) return res.json({ following: false });
  const rows = await blogQuery(
    "SELECT id FROM follows WHERE follower_id = ? AND author_id = ?",
    [req.user.id, req.params.authorId]
  );
  res.json({ following: rows.length > 0 });
}));

router.get("/blog/my-following", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT u.id, u.name, u.email, u.avatar_url, u.bio, u.is_verified,
           f.created_at AS followed_at,
           (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND status = 'published') AS post_count
    FROM follows f JOIN users u ON u.id = f.author_id
    WHERE f.follower_id = ?
    ORDER BY f.created_at DESC
  `, [req.user.id]);
  res.json(rows);
}));

// ═══════════════════════════════════════════════════════════
// 👤 AUTHOR PUBLIC PROFILE
// ═══════════════════════════════════════════════════════════

router.get("/blog/authors/:id", blogOptionalAuth, blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT id, name, bio, avatar_url, website, twitter, linkedin,
           is_verified, role_type, created_at
    FROM users WHERE id = ? AND status = 'approved'
  `, [req.params.id]);

  if (!rows.length) return res.status(404).json({ error: "Author not found" });
  const author = rows[0];

  const stats = await blogQuery(`
    SELECT 
      (SELECT COUNT(*) FROM posts WHERE author_id = ? AND status = 'published') AS post_count,
      (SELECT COALESCE(SUM(views),0) FROM posts WHERE author_id = ? AND status = 'published') AS total_views,
      (SELECT COUNT(*) FROM follows WHERE author_id = ?) AS follower_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following_count
  `, [author.id, author.id, author.id, author.id]);

  const posts = await blogQuery(`
    SELECT p.id, p.title, p.slug, p.excerpt, p.cover_image, p.read_time,
           p.views, p.published_at,
           c.name AS category_name, c.slug AS category_slug, c.color AS category_color,
           (SELECT COUNT(*) FROM reactions WHERE post_id = p.id) AS like_count,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND status = 'approved') AS comment_count
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.author_id = ? AND p.status = 'published' AND p.deleted_at IS NULL
    ORDER BY p.published_at DESC LIMIT 12
  `, [author.id]);

  posts.forEach(p => { p.time_ago = timeAgo(p.published_at); });

  res.json({ author, stats: stats[0], posts });
}));

// ═══════════════════════════════════════════════════════════
// 📚 READING HISTORY
// ═══════════════════════════════════════════════════════════

router.get("/blog/reading-history", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT DISTINCT p.id, p.title, p.slug, p.cover_image, p.read_time,
           u.name AS author_name, u.avatar_url AS author_avatar,
           MAX(rh.read_at) AS last_read
    FROM reading_history rh
    JOIN posts p ON p.id = rh.post_id
    JOIN users u ON u.id = p.author_id
    WHERE rh.user_id = ? AND p.status = 'published' AND p.deleted_at IS NULL
    GROUP BY p.id
    ORDER BY last_read DESC
    LIMIT 50
  `, [req.user.id]);

  rows.forEach(r => { r.time_ago = timeAgo(r.last_read); });
  res.json(rows);
}));

router.delete("/blog/reading-history", blogAuthRequired, blogAsync(async (req, res) => {
  await blogQuery("DELETE FROM reading_history WHERE user_id = ?", [req.user.id]);
  res.json({ message: "Reading history cleared" });
}));

// ═══════════════════════════════════════════════════════════
// 🔔 NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

router.get("/blog/notifications", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT * FROM notifications WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 50
  `, [req.user.id]);

  rows.forEach(n => { n.time_ago = timeAgo(n.created_at); });

  const unread = await blogQuery(
    "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = FALSE",
    [req.user.id]
  );

  res.json({ notifications: rows, unread_count: unread[0].count });
}));

router.put("/blog/notifications/:id/read", blogAuthRequired, blogAsync(async (req, res) => {
  await blogQuery(
    "UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?",
    [req.params.id, req.user.id]
  );
  res.json({ message: "Marked as read" });
}));

router.put("/blog/notifications/read-all", blogAuthRequired, blogAsync(async (req, res) => {
  await blogQuery(
    "UPDATE notifications SET is_read = TRUE WHERE user_id = ?",
    [req.user.id]
  );
  res.json({ message: "All marked as read" });
}));

router.delete("/blog/notifications/:id", blogAuthRequired, blogAsync(async (req, res) => {
  await blogQuery("DELETE FROM notifications WHERE id = ? AND user_id = ?",
    [req.params.id, req.user.id]);
  res.json({ message: "Notification deleted" });
}));

// ═══════════════════════════════════════════════════════════
// 👤 AUTHOR DASHBOARD
// ═══════════════════════════════════════════════════════════

router.get("/blog/author/my-posts", blogAuthRequired, blogAsync(async (req, res) => {
  const { status, include_trash } = req.query;
  let where = "WHERE p.author_id = ?";
  const params = [req.user.id];

  if (!include_trash) where += " AND p.deleted_at IS NULL";

  if (status && ["published", "draft", "scheduled", "archived"].includes(status)) {
    where += " AND p.status = ?";
    params.push(status);
  }

  const posts = await blogQuery(`
    SELECT p.*, c.name AS category_name,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
           (SELECT COUNT(*) FROM reactions WHERE post_id = p.id) AS reaction_count,
           (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id) AS bookmark_count
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    ${where}
    ORDER BY p.created_at DESC
  `, params);

  posts.forEach(p => {
    p.time_ago = timeAgo(p.created_at);
  });
  res.json(posts);
}));

router.get("/blog/author/stats", blogAuthRequired, blogAsync(async (req, res) => {
  const posts = await blogQuery(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(status = 'published'), 0) AS published,
           COALESCE(SUM(status = 'draft'), 0) AS drafts,
           COALESCE(SUM(status = 'scheduled'), 0) AS scheduled,
           COALESCE(SUM(views), 0) AS total_views,
           COALESCE(SUM(unique_views), 0) AS unique_views
    FROM posts WHERE author_id = ? AND deleted_at IS NULL
  `, [req.user.id]);

  const reactions = await blogQuery(`
    SELECT COUNT(*) AS total FROM reactions r
    JOIN posts p ON p.id = r.post_id WHERE p.author_id = ?
  `, [req.user.id]);

  const comments = await blogQuery(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(c.status = 'pending'), 0) AS pending
    FROM comments c
    JOIN posts p ON p.id = c.post_id WHERE p.author_id = ?
  `, [req.user.id]);

  const followers = await blogQuery(
    "SELECT COUNT(*) AS total FROM follows WHERE author_id = ?",
    [req.user.id]
  );

  const bookmarks = await blogQuery(`
    SELECT COUNT(*) AS total FROM bookmarks b
    JOIN posts p ON p.id = b.post_id WHERE p.author_id = ?
  `, [req.user.id]);

  res.json({
    posts: posts[0],
    reactions: reactions[0].total,
    comments: comments[0],
    followers: followers[0].total,
    bookmarks: bookmarks[0].total
  });
}));

// 📊 Author analytics (last 30 days)
router.get("/blog/author/analytics", blogAuthRequired, blogAsync(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);

  const daily = await blogQuery(`
    SELECT pa.view_date, SUM(pa.views) AS views, SUM(pa.unique_views) AS unique_views
    FROM post_analytics pa
    JOIN posts p ON p.id = pa.post_id
    WHERE p.author_id = ? AND pa.view_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    GROUP BY pa.view_date ORDER BY pa.view_date ASC
  `, [req.user.id, days]);

  const topPosts = await blogQuery(`
    SELECT p.id, p.title, p.slug, p.views, p.unique_views,
           (SELECT COUNT(*) FROM reactions WHERE post_id = p.id) AS like_count,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count
    FROM posts p
    WHERE p.author_id = ? AND p.status = 'published' AND p.deleted_at IS NULL
    ORDER BY p.views DESC LIMIT 5
  `, [req.user.id]);

  res.json({ daily, top_posts: topPosts });
}));

// ═══════════════════════════════════════════════════════════
// 👑 SUPER ADMIN — FULL CONTROL
// ═══════════════════════════════════════════════════════════

router.get("/blog/admin/users", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { status, role_type, search } = req.query;
  let where = "WHERE role != 'admin'";
  const params = [];

  if (status && ["pending", "approved", "rejected"].includes(status)) {
    where += " AND status = ?";
    params.push(status);
  }
  if (role_type && ["user", "author"].includes(role_type)) {
    where += " AND role_type = ?";
    params.push(role_type);
  }
  if (search) {
    where += " AND (name LIKE ? OR email LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s);
  }

  const users = await blogQuery(`
    SELECT id, name, email, role, role_type, status, bio, avatar_url,
           is_verified, verified_at, created_at, approved_at, last_login,
           email_verified
    FROM users ${where}
    ORDER BY
      is_verified DESC,
      CASE status WHEN 'pending' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END,
      created_at DESC
  `, params);
  res.json(users);
}));

router.put("/blog/admin/users/:id/status", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { status } = req.body;
  if (!["approved", "rejected", "pending"].includes(status))
    return res.status(400).json({ error: "Invalid status" });

  await blogQuery(
    "UPDATE users SET status = ?, approved_at = NOW(), approved_by = ? WHERE id = ?",
    [status, req.user.id, req.params.id]
  );

  if (status === "approved") {
    await createNotification(req.params.id, "system", "Account Approved",
      "Your account has been approved! You can now login.", "/login");
  }

  await logActivity(req.user.id, `user_${status}`, "user", req.params.id, {}, req.ip);
  res.json({ message: `User ${status}` });
}));

router.put("/blog/admin/users/:id/verify", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { verified } = req.body;
  const val = verified ? 1 : 0;
  await blogQuery(
    "UPDATE users SET is_verified = ?, verified_at = ?, verified_by = ? WHERE id = ?",
    [val, val ? new Date() : null, val ? req.user.id : null, req.params.id]
  );

  await logActivity(req.user.id, val ? "verify_user" : "unverify_user", "user", req.params.id, {}, req.ip);
  res.json({
    message: val ? "User verified ✅" : "Verification removed",
    is_verified: !!val
  });
}));

router.put("/blog/admin/users/:id/make-author", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  await blogQuery(
    "UPDATE users SET role_type = 'author' WHERE id = ?",
    [req.params.id]
  );
  await createNotification(req.params.id, "system", "You're now an Author ✍️",
    "You can now create and publish blog posts!", "/dashboard");
  await logActivity(req.user.id, "make_author", "user", req.params.id, {}, req.ip);
  res.json({ message: "User promoted to Author ✍️" });
}));

router.put("/blog/admin/users/:id/make-user", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  await blogQuery(
    "UPDATE users SET role_type = 'user' WHERE id = ?",
    [req.params.id]
  );
  await logActivity(req.user.id, "make_user", "user", req.params.id, {}, req.ip);
  res.json({ message: "User demoted to Regular User 👤" });
}));

router.delete("/blog/admin/users/:id", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: "Cannot delete yourself" });

  await blogQuery("DELETE FROM users WHERE id = ?", [req.params.id]);
  await logActivity(req.user.id, "delete_user", "user", req.params.id, {}, req.ip);
  res.json({ message: "User deleted" });
}));

// Bulk user actions
router.post("/blog/admin/users/bulk", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { ids = [], action } = req.body;
  if (!ids.length) return res.status(400).json({ error: "No users selected" });
  if (!["approve", "reject", "delete", "verify", "unverify"].includes(action))
    return res.status(400).json({ error: "Invalid action" });

  let query = "";
  let params = [];

  if (action === "approve") {
    query = `UPDATE users SET status = 'approved', approved_at = NOW(), approved_by = ? WHERE id IN (${ids.map(() => '?').join(',')})`;
    params = [req.user.id, ...ids];
  } else if (action === "reject") {
    query = `UPDATE users SET status = 'rejected' WHERE id IN (${ids.map(() => '?').join(',')})`;
    params = ids;
  } else if (action === "delete") {
    query = `DELETE FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND id != ?`;
    params = [...ids, req.user.id];
  } else if (action === "verify") {
    query = `UPDATE users SET is_verified = 1, verified_at = NOW(), verified_by = ? WHERE id IN (${ids.map(() => '?').join(',')})`;
    params = [req.user.id, ...ids];
  } else if (action === "unverify") {
    query = `UPDATE users SET is_verified = 0, verified_at = NULL, verified_by = NULL WHERE id IN (${ids.map(() => '?').join(',')})`;
    params = ids;
  }

  await blogQuery(query, params);
  await logActivity(req.user.id, `bulk_${action}_users`, "user", null, { ids }, req.ip);
  res.json({ message: `Bulk ${action} done on ${ids.length} users` });
}));

router.get("/blog/admin/posts/all", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { status, author_id, search, include_trash } = req.query;
  let where = "WHERE 1=1";
  const params = [];

  if (!include_trash) where += " AND p.deleted_at IS NULL";

  if (status && ["published", "draft", "scheduled", "archived"].includes(status)) {
    where += " AND p.status = ?";
    params.push(status);
  }
  if (author_id) {
    where += " AND p.author_id = ?";
    params.push(author_id);
  }
  if (search) {
    where += " AND (p.title LIKE ? OR p.slug LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s);
  }

  const posts = await blogQuery(`
    SELECT p.*,
           u.name AS author_name, u.email AS author_email,
           u.avatar_url AS author_avatar, u.is_verified AS author_verified,
           c.name AS category_name,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
           (SELECT COUNT(*) FROM reactions WHERE post_id = p.id) AS reaction_count,
           (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id) AS bookmark_count
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    ${where}
    ORDER BY p.created_at DESC
  `, params);

  posts.forEach(p => { p.time_ago = timeAgo(p.created_at); });
  res.json(posts);
}));

router.delete("/blog/admin/posts/:id", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const rows = await blogQuery("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Post not found" });
  if (rows[0].cover_public_id) {
    await deleteBlogFromCloudinary(rows[0].cover_public_id).catch(() => {});
  }
  await blogQuery("DELETE FROM posts WHERE id = ?", [req.params.id]);
  await logActivity(req.user.id, "admin_delete_post", "post", req.params.id, {}, req.ip);
  res.json({ message: "Post deleted" });
}));

// Bulk post actions
router.post("/blog/admin/posts/bulk", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { ids = [], action } = req.body;
  if (!ids.length) return res.status(400).json({ error: "No posts selected" });
  if (!["publish", "draft", "delete", "feature", "unfeature", "pin", "unpin"].includes(action))
    return res.status(400).json({ error: "Invalid action" });

  const placeholders = ids.map(() => '?').join(',');
  let query = "";

  if (action === "publish") query = `UPDATE posts SET status = 'published', published_at = COALESCE(published_at, NOW()) WHERE id IN (${placeholders})`;
  else if (action === "draft") query = `UPDATE posts SET status = 'draft' WHERE id IN (${placeholders})`;
  else if (action === "delete") query = `UPDATE posts SET deleted_at = NOW() WHERE id IN (${placeholders})`;
  else if (action === "feature") query = `UPDATE posts SET featured = 1 WHERE id IN (${placeholders})`;
  else if (action === "unfeature") query = `UPDATE posts SET featured = 0 WHERE id IN (${placeholders})`;
  else if (action === "pin") query = `UPDATE posts SET is_pinned = 1 WHERE id IN (${placeholders})`;
  else if (action === "unpin") query = `UPDATE posts SET is_pinned = 0 WHERE id IN (${placeholders})`;

  await blogQuery(query, ids);
  await logActivity(req.user.id, `bulk_${action}_posts`, "post", null, { ids }, req.ip);
  res.json({ message: `Bulk ${action} done on ${ids.length} posts` });
}));

router.get("/blog/admin/stats", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const posts = await blogQuery(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(status='published'), 0) AS published,
      COALESCE(SUM(status='draft'), 0) AS drafts,
      COALESCE(SUM(status='scheduled'), 0) AS scheduled,
      COALESCE(SUM(deleted_at IS NOT NULL), 0) AS trashed,
      COALESCE(SUM(views), 0) AS total_views
    FROM posts
  `);
  const comments = await blogQuery(`
    SELECT COUNT(*) AS total, COALESCE(SUM(status='pending'), 0) AS pending,
           COALESCE(SUM(status='spam'), 0) AS spam
    FROM comments
  `);
  const subscribers = await blogQuery("SELECT COUNT(*) AS total FROM subscribers");
  const reactions = await blogQuery("SELECT COUNT(*) AS total FROM reactions");
  const users = await blogQuery(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(status='pending'), 0) AS pending,
      COALESCE(SUM(status='approved'), 0) AS approved,
      COALESCE(SUM(is_verified), 0) AS verified,
      COALESCE(SUM(role_type='author'), 0) AS authors
    FROM users WHERE role != 'admin'
  `);
  const ads = await blogQuery(`
    SELECT COUNT(*) AS total, COALESCE(SUM(impressions), 0) AS impressions,
           COALESCE(SUM(clicks), 0) AS clicks FROM ads
  `);
  const reports = await blogQuery(
    "SELECT COUNT(*) AS total, COALESCE(SUM(status='pending'), 0) AS pending FROM reports"
  );
  const bookmarks = await blogQuery("SELECT COUNT(*) AS total FROM bookmarks");
  const follows = await blogQuery("SELECT COUNT(*) AS total FROM follows");

  res.json({
    posts: posts[0], comments: comments[0],
    subscribers: subscribers[0].total, reactions: reactions[0].total,
    users: users[0], ads: ads[0], reports: reports[0],
    bookmarks: bookmarks[0].total, follows: follows[0].total
  });
}));

// 📊 Admin analytics
router.get("/blog/admin/analytics", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 90);

  const daily = await blogQuery(`
    SELECT view_date, SUM(views) AS views, SUM(unique_views) AS unique_views
    FROM post_analytics
    WHERE view_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    GROUP BY view_date ORDER BY view_date ASC
  `, [days]);

  const topAuthors = await blogQuery(`
    SELECT u.id, u.name, u.avatar_url, u.is_verified,
           COUNT(p.id) AS post_count,
           COALESCE(SUM(p.views), 0) AS total_views
    FROM users u
    LEFT JOIN posts p ON p.author_id = u.id AND p.status = 'published' AND p.deleted_at IS NULL
    WHERE u.role != 'admin' AND u.role_type = 'author'
    GROUP BY u.id
    ORDER BY total_views DESC LIMIT 5
  `);

  const topPosts = await blogQuery(`
    SELECT id, title, slug, views, unique_views, published_at
    FROM posts WHERE status = 'published' AND deleted_at IS NULL
    ORDER BY views DESC LIMIT 5
  `);

  res.json({ daily, top_authors: topAuthors, top_posts: topPosts });
}));

// 📜 Activity log
router.get("/blog/admin/activity-log", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = await blogQuery(`
    SELECT al.*, u.name AS user_name, u.email AS user_email
    FROM activity_log al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.created_at DESC LIMIT ?
  `, [limit]);

  rows.forEach(r => { r.time_ago = timeAgo(r.created_at); });
  res.json(rows);
}));

// ═══════════════════════════════════════════════════════════
// ❤️ REACTIONS
// ═══════════════════════════════════════════════════════════

router.post("/blog/posts/:postId/react", blogAsync(async (req, res) => {
  const { device_id, reaction_type } = req.body;
  if (!device_id) return res.status(400).json({ error: "Device ID required" });

  const valid = ["like", "love", "haha", "wow", "sad", "fire", "clap"];
  if (!valid.includes(reaction_type))
    return res.status(400).json({ error: "Invalid reaction type" });

  const postRows = await blogQuery(
    "SELECT id FROM posts WHERE id = ? AND status = 'published'",
    [req.params.postId]
  );
  if (!postRows.length) return res.status(404).json({ error: "Post not found" });

  const existing = await blogQuery(
    "SELECT id, reaction_type FROM reactions WHERE post_id = ? AND user_device = ?",
    [req.params.postId, device_id]
  );

  let userReaction = null;
  if (existing.length) {
    if (existing[0].reaction_type === reaction_type) {
      await blogQuery("DELETE FROM reactions WHERE id = ?", [existing[0].id]);
      userReaction = null;
    } else {
      await blogQuery("UPDATE reactions SET reaction_type = ? WHERE id = ?",
        [reaction_type, existing[0].id]);
      userReaction = reaction_type;
    }
  } else {
    await blogQuery(
      "INSERT INTO reactions (post_id, user_device, reaction_type) VALUES (?, ?, ?)",
      [req.params.postId, device_id, reaction_type]
    );
    userReaction = reaction_type;
  }

  const counts = await blogQuery(
    "SELECT reaction_type, COUNT(*) AS count FROM reactions WHERE post_id = ? GROUP BY reaction_type",
    [req.params.postId]
  );

  res.json({
    reactions: counts.reduce((acc, c) => ({ ...acc, [c.reaction_type]: c.count }), {}),
    userReaction
  });
}));

router.get("/blog/posts/:postId/reactions", blogAsync(async (req, res) => {
  const { device_id } = req.query;
  const counts = await blogQuery(
    "SELECT reaction_type, COUNT(*) AS count FROM reactions WHERE post_id = ? GROUP BY reaction_type",
    [req.params.postId]
  );
  let userReaction = null;
  if (device_id) {
    const userRow = await blogQuery(
      "SELECT reaction_type FROM reactions WHERE post_id = ? AND user_device = ?",
      [req.params.postId, device_id]
    );
    userReaction = userRow[0]?.reaction_type || null;
  }
  res.json({
    reactions: counts.reduce((acc, c) => ({ ...acc, [c.reaction_type]: c.count }), {}),
    userReaction
  });
}));

// ═══════════════════════════════════════════════════════════
// 💬 COMMENTS
// ═══════════════════════════════════════════════════════════

router.get("/blog/posts/:postId/comments", blogOptionalAuth, blogAsync(async (req, res) => {
  const deviceId = req.headers['x-device-id'] || req.query.device_id;

  const rows = await blogQuery(`
    SELECT c.id, c.parent_id, c.author_name, c.author_avatar, c.content,
           c.created_at, c.like_count,
           (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS live_like_count
    FROM comments c
    WHERE c.post_id = ? AND c.status = 'approved'
    ORDER BY c.created_at ASC
  `, [req.params.postId]);

  // Check which comments user liked
  let likedIds = [];
  if (deviceId) {
    const likes = await blogQuery(
      `SELECT comment_id FROM comment_likes 
       WHERE device_id = ? AND comment_id IN (${rows.map(() => '?').join(',') || '0'})`,
      [deviceId, ...rows.map(r => r.id)]
    );
    likedIds = likes.map(l => l.comment_id);
  }

  const map = {};
  const roots = [];
  rows.forEach(c => {
    c.replies = [];
    c.is_liked = likedIds.includes(c.id);
    c.like_count = c.live_like_count || c.like_count || 0;
    c.time_ago = timeAgo(c.created_at);
    map[c.id] = c;
  });
  rows.forEach(c => {
    if (c.parent_id && map[c.parent_id]) map[c.parent_id].replies.push(c);
    else roots.push(c);
  });

  res.json(roots);
}));

router.post("/blog/posts/:postId/comments",
  rateLimit({ windowMs: 60 * 1000, max: 5 }),
  blogAsync(async (req, res) => {
    const { author_name, author_email, content, parent_id, guest_name } = req.body;

    if (!content || content.length < 3 || content.length > 5000)
      return res.status(400).json({ error: "Comment must be 3-5000 characters" });

    const postRows = await blogQuery(
      "SELECT id, author_id FROM posts WHERE id = ? AND status = 'published'",
      [req.params.postId]
    );
    if (!postRows.length) return res.status(404).json({ error: "Post not found" });

    let finalName, finalEmail, finalAvatar, autoStatus = "pending", userId = null;

    if (author_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author_email)) {
      const userRows = await blogQuery(
        `SELECT id, name, avatar_url, role, role_type, is_verified 
         FROM users WHERE email = ? AND status = 'approved' LIMIT 1`,
        [author_email.trim().toLowerCase()]
      );

      if (userRows.length) {
        const user = userRows[0];
        finalName = user.name;
        finalEmail = author_email.trim().toLowerCase();
        finalAvatar = user.avatar_url;
        autoStatus = "approved";
        userId = user.id;
      } else {
        finalName = (author_name || guest_name || "Anonymous").trim();
        finalEmail = author_email.trim().toLowerCase();
        finalAvatar = null;
      }
    } else {
      finalName = (guest_name || author_name || "Guest").trim();
      finalEmail = "guest@inkwell.local";
      finalAvatar = null;
    }

    // Spam check
    const recent = await blogQuery(
      `SELECT id FROM comments 
       WHERE author_ip = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 SECOND)`,
      [req.ip]
    );
    if (recent.length)
      return res.status(429).json({ error: "Please wait a moment before commenting again" });

    const result = await blogQuery(
      `INSERT INTO comments 
       (post_id, parent_id, author_name, author_email, author_avatar, content, author_ip, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.postId, parent_id || null, finalName,
        finalEmail, finalAvatar, content.trim(), req.ip, autoStatus
      ]
    );

    // Notify post author
    if (postRows[0].author_id && postRows[0].author_id !== userId) {
      const post = await blogQuery("SELECT title, slug FROM posts WHERE id = ?", [req.params.postId]);
      await createNotification(
        postRows[0].author_id,
        "comment",
        "New Comment",
        `${finalName} commented on "${post[0].title}"`,
        `/post/${post[0].slug}`
      );
    }

    // Notify parent comment author
    if (parent_id) {
      const parent = await blogQuery(
        "SELECT author_email FROM comments WHERE id = ?", [parent_id]
      );
      if (parent.length) {
        const parentUser = await blogQuery(
          "SELECT id FROM users WHERE email = ? AND id != ?",
          [parent[0].author_email, userId]
        );
        if (parentUser.length) {
          const post = await blogQuery("SELECT title, slug FROM posts WHERE id = ?", [req.params.postId]);
          await createNotification(
            parentUser[0].id,
            "reply",
            "New Reply",
            `${finalName} replied to your comment`,
            `/post/${post[0].slug}`
          );
        }
      }
    }

    res.status(201).json({
      id: result.insertId,
      status: autoStatus,
      message: autoStatus === "approved"
        ? "✅ Comment posted successfully!"
        : "✅ Comment submitted! It will appear after moderation."
    });
  })
);

// ❤️ Like/unlike comment
router.post("/blog/comments/:id/like", blogAsync(async (req, res) => {
  const { device_id } = req.body;
  if (!device_id) return res.status(400).json({ error: "Device ID required" });

  const existing = await blogQuery(
    "SELECT id FROM comment_likes WHERE comment_id = ? AND device_id = ?",
    [req.params.id, device_id]
  );

  if (existing.length) {
    await blogQuery("DELETE FROM comment_likes WHERE id = ?", [existing[0].id]);
  } else {
    await blogQuery(
      "INSERT INTO comment_likes (comment_id, device_id) VALUES (?, ?)",
      [req.params.id, device_id]
    );
  }

  const count = await blogQuery(
    "SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = ?",
    [req.params.id]
  );

  res.json({
    liked: existing.length === 0,
    count: count[0].count
  });
}));

// ✏️ Edit own comment (within 15 min)
router.put("/blog/comments/:id", blogOptionalAuth, blogAsync(async (req, res) => {
  const { content, author_email } = req.body;
  if (!content || content.length < 3)
    return res.status(400).json({ error: "Content required" });

  const rows = await blogQuery("SELECT * FROM comments WHERE id = ?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Comment not found" });

  const comment = rows[0];
  const age = (Date.now() - new Date(comment.created_at).getTime()) / 1000;
  if (age > 900) return res.status(403).json({ error: "Edit window expired (15 min)" });

  if (!author_email || author_email !== comment.author_email)
    return res.status(403).json({ error: "Not authorized to edit" });

  await blogQuery(
    "UPDATE comments SET content = ?, is_edited = TRUE WHERE id = ?",
    [content.trim(), req.params.id]
  );

  res.json({ message: "Comment updated" });
}));

// 🚩 Report comment
router.post("/blog/comments/:id/report", blogAsync(async (req, res) => {
  const { reason, details, device_id } = req.body;
  if (!reason) return res.status(400).json({ error: "Reason required" });

  await blogQuery(
    `INSERT INTO reports (reporter_device, target_type, target_id, reason, details)
     VALUES (?, 'comment', ?, ?, ?)`,
    [device_id || null, req.params.id, reason, details || null]
  );

  res.json({ message: "Report submitted. Thank you!" });
}));

// 🚩 Report post
router.post("/blog/posts/:id/report", blogAsync(async (req, res) => {
  const { reason, details, device_id } = req.body;
  if (!reason) return res.status(400).json({ error: "Reason required" });

  await blogQuery(
    `INSERT INTO reports (reporter_device, target_type, target_id, reason, details)
     VALUES (?, 'post', ?, ?, ?)`,
    [device_id || null, req.params.id, reason, details || null]
  );

  res.json({ message: "Report submitted. Thank you!" });
}));

// Admin — view reports
router.get("/blog/admin/reports", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { status = 'pending' } = req.query;
  const rows = await blogQuery(`
    SELECT r.*,
      CASE 
        WHEN r.target_type = 'post' THEN (SELECT title FROM posts WHERE id = r.target_id)
        WHEN r.target_type = 'comment' THEN (SELECT LEFT(content, 100) FROM comments WHERE id = r.target_id)
        ELSE NULL
      END AS target_preview
    FROM reports r
    WHERE r.status = ?
    ORDER BY r.created_at DESC
  `, [status]);

  rows.forEach(r => { r.time_ago = timeAgo(r.created_at); });
  res.json(rows);
}));

router.put("/blog/admin/reports/:id", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { status } = req.body;
  if (!["pending", "reviewed", "dismissed", "action_taken"].includes(status))
    return res.status(400).json({ error: "Invalid status" });

  await blogQuery("UPDATE reports SET status = ? WHERE id = ?", [status, req.params.id]);
  res.json({ message: "Report updated" });
}));

// Admin — manage comments
router.get("/blog/comments", blogAuthRequired, blogAsync(async (req, res) => {
  const { status } = req.query;
  let where = "";
  const params = [];

  if (req.user.role !== "admin") {
    where = "WHERE p.author_id = ?";
    params.push(req.user.id);
    if (status) { where += " AND c.status = ?"; params.push(status); }
  } else if (status) {
    where = "WHERE c.status = ?";
    params.push(status);
  }

  const rows = await blogQuery(`
    SELECT c.*, p.title AS post_title, p.slug AS post_slug
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    ${where}
    ORDER BY c.created_at DESC LIMIT 200
  `, params);

  rows.forEach(r => { r.time_ago = timeAgo(r.created_at); });
  res.json(rows);
}));

// ✏️ Admin reply to comment
router.post("/blog/comments/:id/reply", blogAuthRequired, blogAsync(async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: "Content required" });

  const parent = await blogQuery("SELECT * FROM comments WHERE id = ?", [req.params.id]);
  if (!parent.length) return res.status(404).json({ error: "Parent comment not found" });

  const user = await blogQuery("SELECT name, email, avatar_url, is_verified FROM users WHERE id = ?", [req.user.id]);

  const result = await blogQuery(
    `INSERT INTO comments (post_id, parent_id, author_name, author_email, author_avatar, content, author_ip, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')`,
    [
      parent[0].post_id, parent[0].id,
      user[0].name + (user[0].is_verified ? " ✅" : ""),
      user[0].email, user[0].avatar_url,
      content.trim(), req.ip
    ]
  );

  res.json({ id: result.insertId, message: "Reply posted" });
}));

router.put("/blog/comments/:id", blogAuthRequired, blogAsync(async (req, res) => {
  const { status } = req.body;
  if (!["pending", "approved", "spam"].includes(status))
    return res.status(400).json({ error: "Invalid status" });
  await blogQuery("UPDATE comments SET status = ? WHERE id = ?", [status, req.params.id]);
  res.json({ message: "Comment updated" });
}));

router.delete("/blog/comments/:id", blogAuthRequired, blogAsync(async (req, res) => {
  await blogQuery("DELETE FROM comments WHERE id = ?", [req.params.id]);
  res.json({ message: "Comment deleted" });
}));

// Bulk comments
router.post("/blog/admin/comments/bulk", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { ids = [], action } = req.body;
  if (!ids.length) return res.status(400).json({ error: "No comments selected" });
  if (!["approve", "spam", "delete"].includes(action))
    return res.status(400).json({ error: "Invalid action" });

  const placeholders = ids.map(() => '?').join(',');

  if (action === "approve") await blogQuery(`UPDATE comments SET status = 'approved' WHERE id IN (${placeholders})`, ids);
  else if (action === "spam") await blogQuery(`UPDATE comments SET status = 'spam' WHERE id IN (${placeholders})`, ids);
  else if (action === "delete") await blogQuery(`DELETE FROM comments WHERE id IN (${placeholders})`, ids);

  res.json({ message: `Bulk ${action} done on ${ids.length} comments` });
}));

// ═══════════════════════════════════════════════════════════
// 📤 UPLOADS
// ═══════════════════════════════════════════════════════════

router.post("/blog/upload/cover", blogAuthRequired, uploadBlogCover.single("file"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

router.post("/blog/upload/content", blogAuthRequired, uploadBlogContent.single("file"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

router.post("/blog/upload/avatar", blogAuthRequired, uploadBlogAvatar.single("file"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

router.post("/blog/upload/file", blogAuthRequired, uploadBlogFile.single("file"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: req.file.path, public_id: req.file.filename, size: req.file.size });
  })
);

router.post("/blog/upload/base64", blogAuthRequired, blogAsync(async (req, res) => {
  const { image, folder } = req.body;
  if (!image) return res.status(400).json({ error: "No image data" });
  const result = await uploadBlogBase64(image, folder || "blog/content");
  res.json(result);
}));

// ═══════════════════════════════════════════════════════════
// 📂 CATEGORIES
// ═══════════════════════════════════════════════════════════

router.get("/blog/categories", blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT c.*, COUNT(p.id) AS post_count
    FROM categories c
    LEFT JOIN posts p ON p.category_id = c.id 
      AND p.status = 'published' AND p.deleted_at IS NULL
    GROUP BY c.id ORDER BY post_count DESC, c.name
  `);
  res.json(rows);
}));

router.post("/blog/categories", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { name, description, color } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const slug = blogSlugify(name);
  try {
    const result = await blogQuery(
      "INSERT INTO categories (name, slug, description, color) VALUES (?, ?, ?, ?)",
      [name, slug, description || null, color || "#4f46e5"]
    );
    res.status(201).json({ id: result.insertId, slug });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "Category already exists" });
    throw e;
  }
}));

router.put("/blog/categories/:id", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { name, description, color } = req.body;
  const slug = blogSlugify(name);
  await blogQuery(
    "UPDATE categories SET name = ?, slug = ?, description = ?, color = ? WHERE id = ?",
    [name, slug, description || null, color || "#4f46e5", req.params.id]
  );
  res.json({ message: "Category updated" });
}));

router.delete("/blog/categories/:id", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  await blogQuery("DELETE FROM categories WHERE id = ?", [req.params.id]);
  res.json({ message: "Category deleted" });
}));

// ═══════════════════════════════════════════════════════════
// 🏷️ TAGS
// ═══════════════════════════════════════════════════════════

router.get("/blog/tags", blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT t.id, t.name, t.slug, COUNT(DISTINCT p.id) AS post_count
    FROM tags t
    LEFT JOIN post_tags pt ON pt.tag_id = t.id
    LEFT JOIN posts p ON p.id = pt.post_id 
      AND p.status = 'published' AND p.deleted_at IS NULL
    GROUP BY t.id ORDER BY post_count DESC LIMIT 30
  `);
  res.json(rows);
}));

router.delete("/blog/admin/tags/:id", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  await blogQuery("DELETE FROM tags WHERE id = ?", [req.params.id]);
  res.json({ message: "Tag deleted" });
}));

// ═══════════════════════════════════════════════════════════
// 📧 NEWSLETTER
// ═══════════════════════════════════════════════════════════

router.post("/blog/subscribe", rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }),
  blogAsync(async (req, res) => {
    const { email, name } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Valid email required" });

    await blogQuery(
      "INSERT IGNORE INTO subscribers (email, name, ip_address) VALUES (?, ?, ?)",
      [email.trim().toLowerCase(), name || null, req.ip]
    );
    res.json({ message: "Subscribed successfully" });
  })
);

router.get("/blog/subscribers", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const rows = await blogQuery(
    "SELECT id, email, name, status, created_at FROM subscribers ORDER BY created_at DESC"
  );
  rows.forEach(r => { r.time_ago = timeAgo(r.created_at); });
  res.json(rows);
}));

router.delete("/blog/subscribers/:id", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  await blogQuery("DELETE FROM subscribers WHERE id = ?", [req.params.id]);
  res.json({ message: "Subscriber removed" });
}));

// ═══════════════════════════════════════════════════════════
// 📢 ADS
// ═══════════════════════════════════════════════════════════

router.get("/blog/ads/:position", blogAsync(async (req, res) => {
  const rows = await blogQuery(
    `SELECT id, name, position, type, content, image_url, link_url
     FROM ads WHERE position = ? AND is_active = TRUE
     ORDER BY RAND() LIMIT 1`,
    [req.params.position]
  );

  if (rows.length) {
    blogQuery("UPDATE ads SET impressions = impressions + 1 WHERE id = ?", [rows[0].id])
      .catch(() => {});
    return res.json(rows[0]);
  }
  res.json(null);
}));

router.post("/blog/ads/:id/click", blogAsync(async (req, res) => {
  await blogQuery("UPDATE ads SET clicks = clicks + 1 WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

router.get("/blog/ads", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const rows = await blogQuery("SELECT * FROM ads ORDER BY created_at DESC");
  res.json(rows);
}));

router.post("/blog/ads", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { name, position, type, content, image_url, link_url } = req.body;
  if (!name || !position || !type)
    return res.status(400).json({ error: "Name, position and type required" });

  const result = await blogQuery(
    `INSERT INTO ads (name, position, type, content, image_url, link_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, position, type, content || null, image_url || null, link_url || null]
  );
  res.status(201).json({ id: result.insertId });
}));

router.put("/blog/ads/:id", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  const { name, position, type, content, image_url, link_url, is_active } = req.body;
  await blogQuery(
    `UPDATE ads SET name = ?, position = ?, type = ?, content = ?,
       image_url = ?, link_url = ?, is_active = ? WHERE id = ?`,
    [name, position, type, content || null, image_url || null, link_url || null,
     is_active ? 1 : 0, req.params.id]
  );
  res.json({ message: "Ad updated" });
}));

router.delete("/blog/ads/:id", blogAuthRequired, blogSuperAdminOnly, blogAsync(async (req, res) => {
  await blogQuery("DELETE FROM ads WHERE id = ?", [req.params.id]);
  res.json({ message: "Ad deleted" });
}));

// ═══════════════════════════════════════════════════════════
// 📊 SHARES
// ═══════════════════════════════════════════════════════════

router.post("/blog/posts/:postId/share", blogAsync(async (req, res) => {
  const { platform } = req.body;
  if (!platform) return res.status(400).json({ error: "Platform required" });
  await blogQuery(
    "INSERT INTO shares (post_id, platform, user_ip) VALUES (?, ?, ?)",
    [req.params.postId, platform, req.ip]
  );
  res.json({ ok: true });
}));

// ═══════════════════════════════════════════════════════════
// ⭐ FEATURED SLIDER
// ═══════════════════════════════════════════════════════════
router.get("/blog/featured-slider", blogAsync(async (req, res) => {
  const posts = await blogQuery(`
    SELECT p.id, p.title, p.slug, p.excerpt, p.cover_image,
           p.views, p.read_time, p.published_at,
           u.id AS author_id, u.name AS author_name,
           u.avatar_url AS author_avatar, u.is_verified AS author_verified,
           c.name AS category_name, c.slug AS category_slug,
           c.color AS category_color
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published'
      AND p.deleted_at IS NULL
      AND u.status = 'approved'
      AND u.is_verified = TRUE
      AND p.id IN (
        SELECT MAX(p2.id)
        FROM posts p2
        JOIN users u2 ON u2.id = p2.author_id
        WHERE p2.status = 'published'
          AND p2.deleted_at IS NULL
          AND u2.status = 'approved'
          AND u2.is_verified = TRUE
        GROUP BY p2.author_id
      )
    ORDER BY p.views DESC
    LIMIT 5
  `);
  res.json(posts);
}));

// ═══════════════════════════════════════════════════════════
// 📡 RSS FEED
// ═══════════════════════════════════════════════════════════
router.get("/blog/rss.xml", blogAsync(async (req, res) => {
  const siteUrl = process.env.SITE_URL || 'https://yourblog.com';
  const posts = await blogQuery(`
    SELECT p.title, p.slug, p.excerpt, p.content, p.published_at,
           u.name AS author_name, c.name AS category_name
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published' AND p.deleted_at IS NULL
    ORDER BY p.published_at DESC LIMIT 20
  `);

  const escapeXml = (str) => String(str || '').replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  }[c]));

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>Blog RSS Feed</title>
<link>${siteUrl}</link>
<description>Latest blog posts</description>
<language>en-in</language>
<atom:link href="${siteUrl}/api/blog/rss.xml" rel="self" type="application/rss+xml"/>
`;

  posts.forEach(p => {
    const pubDate = new Date(parseDelhiDate(p.published_at)).toUTCString();
    xml += `<item>
<title>${escapeXml(p.title)}</title>
<link>${siteUrl}/post/${p.slug}</link>
<guid>${siteUrl}/post/${p.slug}</guid>
<pubDate>${pubDate}</pubDate>
<author>${escapeXml(p.author_name)}</author>
${p.category_name ? `<category>${escapeXml(p.category_name)}</category>` : ''}
<description>${escapeXml(p.excerpt || p.content.substring(0, 200))}</description>
</item>
`;
  });

  xml += `</channel></rss>`;
  res.type('application/rss+xml').send(xml);
}));

// ═══════════════════════════════════════════════════════════
// 🗺️ SITEMAP
// ═══════════════════════════════════════════════════════════
router.get("/blog/sitemap.xml", blogAsync(async (req, res) => {
  const siteUrl = process.env.SITE_URL || 'https://yourblog.com';
  const posts = await blogQuery(`
    SELECT slug, published_at FROM posts
    WHERE status = 'published' AND deleted_at IS NULL
    ORDER BY published_at DESC
  `);
  const categories = await blogQuery("SELECT slug FROM categories");

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${siteUrl}/</loc><priority>1.0</priority></url>
<url><loc>${siteUrl}/blog</loc><priority>0.9</priority></url>
`;

  categories.forEach(c => {
    xml += `<url><loc>${siteUrl}/category/${c.slug}</loc><priority>0.7</priority></url>\n`;
  });

  posts.forEach(p => {
    const lastmod = new Date(parseDelhiDate(p.published_at)).toISOString();
    xml += `<url><loc>${siteUrl}/post/${p.slug}</loc><lastmod>${lastmod}</lastmod><priority>0.8</priority></url>\n`;
  });

  xml += `</urlset>`;
  res.type('application/xml').send(xml);
}));

// ═══════════════════════════════════════════════════════════
// ❤️ HEALTH CHECK
// ═══════════════════════════════════════════════════════════

router.get("/blog/health", (req, res) => {
  res.json({
    status: "ok",
    service: "blog-api",
    time: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
module.exports = router;
