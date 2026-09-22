const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// ✅ Existing imports (school)
const { db, query, transaction, getById, count, exists, blogQuery } = require("../config/db");
const {
  cloudinary,
  // School uploads
  uploadSlider,
  uploadRecent,
  uploadGallery,
  uploadDownload,
  uploadFaculty,
  uploadStudent,
  // 🆕 Blog uploads
  uploadBlogCover,
  uploadBlogContent,
  uploadBlogAvatar,
  uploadBlogFile,
  uploadBlogBase64,
  deleteBlogFromCloudinary
} = require("../config/cloudinary");

const router = express.Router();

// ============================================================
// EXISTING MIDDLEWARE (school)
// ============================================================
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

// ============================================================
// 🏫 SCHOOL ROUTES
// ============================================================
// Aapke existing school routes yahan rahenge (jo already hain)
// Iske baad blog section shuru hota hai
// ...
// (Aapke existing code ko touch nahi karna — bas neeche wala blog section add karo)

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

// ============================================================
// 🆕 BLOG MIDDLEWARE
// ============================================================
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

const blogAdminOnly = (req, res, next) => {
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

// ═══════════════════════════════════════════════════════════
// 🔐 BLOG AUTH
// ═══════════════════════════════════════════════════════════

// POST /api/blog/auth/register — creates pending user
router.post("/blog/auth/register", blogAsync(async (req, res) => {
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
    `INSERT INTO users (name, email, password_hash, role, status)
     VALUES (?, ?, ?, 'author', 'pending')`,
    [name, email, hash]
  );

  res.status(201).json({
    message: "Registration successful! Please wait for super admin approval.",
    user: { id: result.insertId, name, email, status: "pending" }
  });
}));

// POST /api/blog/auth/login
router.post("/blog/auth/login", blogAsync(async (req, res) => {
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

  res.json({ user, token });
}));

// GET /api/blog/auth/me
router.get("/blog/auth/me", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery(
    `SELECT id, name, email, role, status, bio, avatar_url, website, twitter, linkedin
     FROM users WHERE id = ?`,
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: "User not found" });
  res.json(rows[0]);
}));

// PUT /api/blog/auth/profile
router.put("/blog/auth/profile", blogAuthRequired, blogAsync(async (req, res) => {
  const { name, bio, website, twitter, linkedin } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  await blogQuery(
    `UPDATE users SET name = ?, bio = ?, website = ?, twitter = ?, linkedin = ?
     WHERE id = ?`,
    [name, bio || null, website || null, twitter || null, linkedin || null, req.user.id]
  );
  res.json({ message: "Profile updated" });
}));

// PUT /api/blog/auth/password
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

// POST /api/blog/auth/avatar — upload profile photo
router.post(
  "/blog/auth/avatar",
  blogAuthRequired,
  uploadBlogAvatar.single("avatar"),
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
// 🔐 FORGOT / RESET PASSWORD
// ═══════════════════════════════════════════════════════════

// POST /api/blog/auth/forgot-password
router.post("/blog/auth/forgot-password", blogAsync(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  const rows = await blogQuery("SELECT id, name FROM users WHERE email = ?", [email]);
  if (!rows.length) return res.status(404).json({ error: "Email not found" });

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await blogQuery(
    "UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?",
    [token, expires, rows[0].id]
  );

  // ⚠️ Production mein email bhejo. Filhaal token return kar rahe hain.
  res.json({
    message: "Reset token generated successfully",
    reset_token: token,
    reset_url: `/reset-password.html?token=${token}`
  });
}));

// POST /api/blog/auth/reset-password
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
// 📝 BLOG POSTS (Public + Author)
// ═══════════════════════════════════════════════════════════

// GET /api/blog/posts — public list with pagination + filters
router.get("/blog/posts", blogAsync(async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 9, 50);
  const offset = (page - 1) * limit;
  const { category, tag, author, search, featured } = req.query;

  const where = ["p.status = 'published'"];
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

  const countRows = await blogQuery(
    `SELECT COUNT(*) AS total FROM posts p
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereSQL}`,
    params
  );
  const total = countRows[0].total;

  const posts = await blogQuery(
    `SELECT p.id, p.title, p.slug, p.excerpt, p.cover_image, p.views,
            p.read_time, p.featured, p.published_at, p.created_at,
            u.id AS author_id, u.name AS author_name, u.avatar_url AS author_avatar,
            c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
            c.color AS category_color,
            (SELECT COUNT(*) FROM reactions WHERE post_id = p.id) AS like_count,
            (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND status = 'approved') AS comment_count
     FROM posts p
     JOIN users u ON u.id = p.author_id
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereSQL}
     ORDER BY p.published_at DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

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
           u.name AS author_name, u.avatar_url AS author_avatar,
           c.name AS category_name, c.slug AS category_slug, c.color AS category_color
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published' AND p.featured = TRUE
    ORDER BY p.published_at DESC LIMIT 5
  `);
  res.json(posts);
}));

// ═══════════════════════════════════════════════════════════
// 👤 AUTHOR DASHBOARD (isolated — only own posts)
// ═══════════════════════════════════════════════════════════

// GET /api/blog/author/my-posts — author's own posts
router.get("/blog/author/my-posts", blogAuthRequired, blogAsync(async (req, res) => {
  const posts = await blogQuery(`
    SELECT p.*, c.name AS category_name,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
           (SELECT COUNT(*) FROM reactions WHERE post_id = p.id) AS reaction_count
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.author_id = ?
    ORDER BY p.created_at DESC
  `, [req.user.id]);
  res.json(posts);
}));

// GET /api/blog/author/stats
router.get("/blog/author/stats", blogAuthRequired, blogAsync(async (req, res) => {
  const posts = await blogQuery(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(status = 'published'), 0) AS published,
           COALESCE(SUM(status = 'draft'), 0) AS drafts,
           COALESCE(SUM(views), 0) AS total_views
    FROM posts WHERE author_id = ?
  `, [req.user.id]);

  const reactions = await blogQuery(`
    SELECT COUNT(*) AS total FROM reactions r
    JOIN posts p ON p.id = r.post_id WHERE p.author_id = ?
  `, [req.user.id]);

  const comments = await blogQuery(`
    SELECT COUNT(*) AS total FROM comments c
    JOIN posts p ON p.id = c.post_id WHERE p.author_id = ?
  `, [req.user.id]);

  res.json({
    posts: posts[0],
    reactions: reactions[0].total,
    comments: comments[0].total
  });
}));

// ═══════════════════════════════════════════════════════════
// 👑 SUPER ADMIN ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/blog/admin/users — list users (filter by status)
router.get("/blog/admin/users", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
  const { status } = req.query;
  let where = "WHERE role != 'admin'";
  const params = [];

  if (status && ["pending", "approved", "rejected"].includes(status)) {
    where += " AND status = ?";
    params.push(status);
  }

  const users = await blogQuery(`
    SELECT id, name, email, role, status, bio, avatar_url,
           created_at, approved_at
    FROM users ${where}
    ORDER BY
      CASE status WHEN 'pending' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END,
      created_at DESC
  `, params);
  res.json(users);
}));

// PUT /api/blog/admin/users/:id/status — approve/reject
router.put("/blog/admin/users/:id/status", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
  const { status } = req.body;
  if (!["approved", "rejected", "pending"].includes(status))
    return res.status(400).json({ error: "Invalid status" });

  await blogQuery(
    "UPDATE users SET status = ?, approved_at = NOW(), approved_by = ? WHERE id = ?",
    [status, req.user.id, req.params.id]
  );
  res.json({ message: `User ${status}` });
}));

// DELETE /api/blog/admin/users/:id
router.delete("/blog/admin/users/:id", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: "Cannot delete yourself" });
  await blogQuery("DELETE FROM users WHERE id = ?", [req.params.id]);
  res.json({ message: "User deleted" });
}));

// GET /api/blog/admin/posts/all — all posts from all authors
router.get("/blog/admin/posts/all", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
  const posts = await blogQuery(`
    SELECT p.*, u.name AS author_name, u.email AS author_email,
           c.name AS category_name
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.created_at DESC
  `);
  res.json(posts);
}));

// GET /api/blog/admin/stats — global stats
router.get("/blog/admin/stats", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
  const posts = await blogQuery(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(status = 'published'), 0) AS published,
           COALESCE(SUM(status = 'draft'), 0) AS drafts,
           COALESCE(SUM(views), 0) AS total_views
    FROM posts
  `);
  const comments = await blogQuery(`
    SELECT COUNT(*) AS total, COALESCE(SUM(status = 'pending'), 0) AS pending
    FROM comments
  `);
  const subscribers = await blogQuery("SELECT COUNT(*) AS total FROM subscribers");
  const reactions = await blogQuery("SELECT COUNT(*) AS total FROM reactions");
  const users = await blogQuery(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(status = 'pending'), 0) AS pending,
           COALESCE(SUM(status = 'approved'), 0) AS approved
    FROM users WHERE role != 'admin'
  `);
  const ads = await blogQuery(`
    SELECT COUNT(*) AS total, COALESCE(SUM(impressions), 0) AS impressions,
           COALESCE(SUM(clicks), 0) AS clicks FROM ads
  `);

  res.json({
    posts: posts[0],
    comments: comments[0],
    subscribers: subscribers[0].total,
    reactions: reactions[0].total,
    users: users[0],
    ads: ads[0]
  });
}));

// ═══════════════════════════════════════════════════════════
// 📝 POSTS — Create / Update / Delete
// ═══════════════════════════════════════════════════════════

// GET /api/blog/posts/id/:id — for editing (author or admin)
router.get("/blog/posts/id/:id", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT p.*, u.name AS author_name, c.name AS category_name
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = ?
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

  res.json(post);
}));

// GET /api/blog/posts/:slug — public single post
router.get("/blog/posts/:slug", blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT p.*,
           u.id AS author_id, u.name AS author_name,
           u.bio AS author_bio, u.avatar_url AS author_avatar,
           u.website AS author_website, u.twitter AS author_twitter,
           u.linkedin AS author_linkedin,
           c.id AS category_id, c.name AS category_name,
           c.slug AS category_slug, c.color AS category_color,
           (SELECT COUNT(*) FROM reactions WHERE post_id = p.id) AS like_count,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND status = 'approved') AS comment_count
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.slug = ? AND p.status = 'published'
  `, [req.params.slug]);

  if (!rows.length) return res.status(404).json({ error: "Post not found" });
  const post = rows[0];

  blogQuery("UPDATE posts SET views = views + 1 WHERE id = ?", [post.id]).catch(() => {});

  const tags = await blogQuery(`
    SELECT t.id, t.name, t.slug FROM tags t
    JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ?
  `, [post.id]);
  post.tags = tags;

  const related = await blogQuery(`
    SELECT id, title, slug, cover_image, published_at FROM posts
    WHERE category_id = ? AND id != ? AND status = 'published'
    ORDER BY published_at DESC LIMIT 3
  `, [post.category_id, post.id]);
  post.related = related;

  res.json(post);
}));

// POST /api/blog/posts — create (approved authors only)
router.post(
  "/blog/posts",
  blogAuthRequired,
  blogApprovedOnly,
  blogAsync(async (req, res) => {
    const {
      title, excerpt, content, cover_image, cover_public_id,
      category_id, status = "draft", featured = false,
      meta_title, meta_description, tags = []
    } = req.body;

    if (!title || !content)
      return res.status(400).json({ error: "Title and content required" });

    let slug = blogSlugify(title);
    const existing = await blogQuery("SELECT id FROM posts WHERE slug = ?", [slug]);
    if (existing.length) slug = `${slug}-${Date.now()}`;

    const published_at = status === "published" ? new Date() : null;
    const read_time = calcReadTime(content);

    const result = await blogQuery(
      `INSERT INTO posts
       (title, slug, excerpt, content, cover_image, cover_public_id,
        author_id, category_id, status, featured, read_time,
        meta_title, meta_description, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, slug, excerpt || null, content, cover_image || null,
        cover_public_id || null, req.user.id, category_id || null,
        status, featured ? 1 : 0, read_time,
        meta_title || null, meta_description || null, published_at
      ]
    );

    // Save tags
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

    res.status(201).json({ id: result.insertId, slug, message: "Post created" });
  })
);

// PUT /api/blog/posts/:id — update (author or admin)
router.put("/blog/posts/:id", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Post not found" });
  const post = rows[0];

  if (post.author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized to edit this post" });

  const {
    title, excerpt, content, cover_image, cover_public_id,
    category_id, status, featured, meta_title, meta_description, tags = []
  } = req.body;

  if (!title || !content)
    return res.status(400).json({ error: "Title and content required" });

  // Delete old cover if replaced
  if (post.cover_public_id && cover_public_id && post.cover_public_id !== cover_public_id) {
    await deleteBlogFromCloudinary(post.cover_public_id).catch(() => {});
  }

  // published_at logic — draft → published transition
  let published_at = post.published_at;
  if (status === "published" && !published_at) {
    published_at = new Date();
  }

  const read_time = calcReadTime(content);

  await blogQuery(
    `UPDATE posts SET
       title = ?, excerpt = ?, content = ?, cover_image = ?, cover_public_id = ?,
       category_id = ?, status = ?, featured = ?, read_time = ?,
       meta_title = ?, meta_description = ?, published_at = ?
     WHERE id = ?`,
    [
      title, excerpt || null, content, cover_image || null, cover_public_id || null,
      category_id || null, status, featured ? 1 : 0, read_time,
      meta_title || null, meta_description || null, published_at,
      req.params.id
    ]
  );

  // Refresh tags
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

  res.json({ message: "Post updated successfully", status });
}));

// DELETE /api/blog/posts/:id — author or admin
router.delete("/blog/posts/:id", blogAuthRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Post not found" });
  const post = rows[0];

  if (post.author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized to delete this post" });

  if (post.cover_public_id) {
    await deleteBlogFromCloudinary(post.cover_public_id).catch(() => {});
  }

  await blogQuery("DELETE FROM posts WHERE id = ?", [req.params.id]);
  res.json({ message: "Post deleted successfully" });
}));

// ═══════════════════════════════════════════════════════════
// ❤️ REACTIONS (Multiple emojis, one per device)
// ═══════════════════════════════════════════════════════════

// POST /api/blog/posts/:postId/react
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

  if (existing.length) {
    if (existing[0].reaction_type === reaction_type) {
      // Same reaction → remove (toggle off)
      await blogQuery("DELETE FROM reactions WHERE id = ?", [existing[0].id]);
    } else {
      // Different reaction → update
      await blogQuery(
        "UPDATE reactions SET reaction_type = ? WHERE id = ?",
        [reaction_type, existing[0].id]
      );
    }
  } else {
    // New reaction
    await blogQuery(
      "INSERT INTO reactions (post_id, user_device, reaction_type) VALUES (?, ?, ?)",
      [req.params.postId, device_id, reaction_type]
    );
  }

  const counts = await blogQuery(
    "SELECT reaction_type, COUNT(*) AS count FROM reactions WHERE post_id = ? GROUP BY reaction_type",
    [req.params.postId]
  );
  const userRow = await blogQuery(
    "SELECT reaction_type FROM reactions WHERE post_id = ? AND user_device = ?",
    [req.params.postId, device_id]
  );

  res.json({
    reactions: counts.reduce((acc, c) => ({ ...acc, [c.reaction_type]: c.count }), {}),
    userReaction: userRow[0]?.reaction_type || null
  });
}));

// GET /api/blog/posts/:postId/reactions
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
// 💬 COMMENTS (Public — moderated)
// ═══════════════════════════════════════════════════════════

// GET /api/blog/posts/:postId/comments — public approved (nested)
router.get("/blog/posts/:postId/comments", blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT id, parent_id, author_name, author_avatar, content, created_at
    FROM comments
    WHERE post_id = ? AND status = 'approved'
    ORDER BY created_at ASC
  `, [req.params.postId]);

  const map = {};
  const roots = [];
  rows.forEach(c => { c.replies = []; map[c.id] = c; });
  rows.forEach(c => {
    if (c.parent_id && map[c.parent_id]) map[c.parent_id].replies.push(c);
    else roots.push(c);
  });

  res.json(roots);
}));

// POST /api/blog/posts/:postId/comments — submit comment
router.post("/blog/posts/:postId/comments", blogAsync(async (req, res) => {
  const { author_name, author_email, content, parent_id } = req.body;

  if (!author_name || !author_email || !content)
    return res.status(400).json({ error: "All fields required" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author_email))
    return res.status(400).json({ error: "Invalid email format" });
  if (content.length < 3 || content.length > 5000)
    return res.status(400).json({ error: "Comment must be 3-5000 characters" });

  const postRows = await blogQuery(
    "SELECT id FROM posts WHERE id = ? AND status = 'published'",
    [req.params.postId]
  );
  if (!postRows.length) return res.status(404).json({ error: "Post not found" });

  const result = await blogQuery(
    `INSERT INTO comments (post_id, parent_id, author_name, author_email, content, author_ip, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [
      req.params.postId, parent_id || null, author_name.trim(),
      author_email.trim(), content.trim(), req.ip
    ]
  );

  res.status(201).json({
    id: result.insertId,
    message: "Comment submitted for moderation"
  });
}));

// GET /api/blog/comments — admin: all comments
router.get("/blog/comments", blogAuthRequired, blogAsync(async (req, res) => {
  let where = "";
  const params = [];

  if (req.user.role !== "admin") {
    where = "WHERE p.author_id = ?";
    params.push(req.user.id);
  }

  const rows = await blogQuery(`
    SELECT c.*, p.title AS post_title, p.slug AS post_slug
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    ${where}
    ORDER BY c.created_at DESC
  `, params);
  res.json(rows);
}));

// PUT /api/blog/comments/:id — approve/spam
router.put("/blog/comments/:id", blogAuthRequired, blogAsync(async (req, res) => {
  const { status } = req.body;
  if (!["pending", "approved", "spam"].includes(status))
    return res.status(400).json({ error: "Invalid status" });

  await blogQuery("UPDATE comments SET status = ? WHERE id = ?", [status, req.params.id]);
  res.json({ message: "Comment updated" });
}));

// DELETE /api/blog/comments/:id
router.delete("/blog/comments/:id", blogAuthRequired, blogAsync(async (req, res) => {
  await blogQuery("DELETE FROM comments WHERE id = ?", [req.params.id]);
  res.json({ message: "Comment deleted" });
}));

// ═══════════════════════════════════════════════════════════
// 📤 BLOG UPLOADS (Cloudinary)
// ═══════════════════════════════════════════════════════════

router.post(
  "/blog/upload/cover",
  blogAuthRequired,
  uploadBlogCover.single("file"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

router.post(
  "/blog/upload/content",
  blogAuthRequired,
  uploadBlogContent.single("file"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

router.post(
  "/blog/upload/avatar",
  blogAuthRequired,
  uploadBlogAvatar.single("file"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

router.post(
  "/blog/upload/file",
  blogAuthRequired,
  uploadBlogFile.single("file"),
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
    LEFT JOIN posts p ON p.category_id = c.id AND p.status = 'published'
    GROUP BY c.id ORDER BY c.name
  `);
  res.json(rows);
}));

router.post("/blog/categories", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
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

router.put("/blog/categories/:id", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
  const { name, description, color } = req.body;
  const slug = blogSlugify(name);
  await blogQuery(
    "UPDATE categories SET name = ?, slug = ?, description = ?, color = ? WHERE id = ?",
    [name, slug, description || null, color || "#4f46e5", req.params.id]
  );
  res.json({ message: "Category updated" });
}));

router.delete("/blog/categories/:id", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
  await blogQuery("DELETE FROM categories WHERE id = ?", [req.params.id]);
  res.json({ message: "Category deleted" });
}));

// ═══════════════════════════════════════════════════════════
// 🏷️ TAGS
// ═══════════════════════════════════════════════════════════

router.get("/blog/tags", blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT t.id, t.name, t.slug, COUNT(pt.post_id) AS post_count
    FROM tags t
    LEFT JOIN post_tags pt ON pt.tag_id = t.id
    LEFT JOIN posts p ON p.id = pt.post_id AND p.status = 'published'
    GROUP BY t.id ORDER BY post_count DESC LIMIT 30
  `);
  res.json(rows);
}));

// ═══════════════════════════════════════════════════════════
// 📧 NEWSLETTER
// ═══════════════════════════════════════════════════════════

router.post("/blog/subscribe", blogAsync(async (req, res) => {
  const { email, name } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "Valid email required" });

  await blogQuery(
    "INSERT IGNORE INTO subscribers (email, name, ip_address) VALUES (?, ?, ?)",
    [email.trim().toLowerCase(), name || null, req.ip]
  );
  res.json({ message: "Subscribed successfully" });
}));

router.get("/blog/subscribers", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
  const rows = await blogQuery(
    "SELECT id, email, name, status, created_at FROM subscribers ORDER BY created_at DESC"
  );
  res.json(rows);
}));

router.delete("/blog/subscribers/:id", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
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

router.get("/blog/ads", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
  const rows = await blogQuery("SELECT * FROM ads ORDER BY created_at DESC");
  res.json(rows);
}));

router.post("/blog/ads", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
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

router.put("/blog/ads/:id", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
  const { name, position, type, content, image_url, link_url, is_active } = req.body;
  await blogQuery(
    `UPDATE ads SET name = ?, position = ?, type = ?, content = ?,
       image_url = ?, link_url = ?, is_active = ? WHERE id = ?`,
    [name, position, type, content || null, image_url || null, link_url || null,
     is_active ? 1 : 0, req.params.id]
  );
  res.json({ message: "Ad updated" });
}));

router.delete("/blog/ads/:id", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
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
// 📊 BLOG STATS — SUPER ADMIN
// ═══════════════════════════════════════════════════════════

router.get("/blog/stats", blogAuthRequired, blogAdminOnly, blogAsync(async (req, res) => {
  const posts = await blogQuery(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(status = 'published'), 0) AS published,
           COALESCE(SUM(status = 'draft'), 0) AS drafts,
           COALESCE(SUM(views), 0) AS total_views
    FROM posts
  `);
  const comments = await blogQuery(`
    SELECT COUNT(*) AS total, COALESCE(SUM(status = 'pending'), 0) AS pending
    FROM comments
  `);
  const subscribers = await blogQuery("SELECT COUNT(*) AS total FROM subscribers");
  const reactions = await blogQuery("SELECT COUNT(*) AS total FROM reactions");
  const users = await blogQuery(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(status = 'pending'), 0) AS pending,
           COALESCE(SUM(status = 'approved'), 0) AS approved
    FROM users WHERE role != 'admin'
  `);
  const ads = await blogQuery(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(impressions), 0) AS impressions,
           COALESCE(SUM(clicks), 0) AS clicks
    FROM ads
  `);

  res.json({
    posts: posts[0],
    comments: comments[0],
    subscribers: subscribers[0].total,
    reactions: reactions[0].total,
    users: users[0],
    ads: ads[0]
  });
}));

// ═══════════════════════════════════════════════════════════
// ❤️ HEALTH CHECK
// ═══════════════════════════════════════════════════════════

router.get("/blog/health", (req, res) => {
  res.json({
    status: "ok",
    service: "blog-api",
    time: new Date().toISOString()
  });
});

// ============================================================
// EXPORT (school + blog dono)
// ============================================================
module.exports = router;
