const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  query,
  transaction,
  getById,
  count,
  exists,
  paginate
} = require("./db");
const {
  uploadBlogCover,
  uploadBlogContent,
  uploadAvatar,
  uploadBlogFile,
  uploadBase64,
  deleteFromCloudinary
} = require("./cloudinary");

const router = express.Router();

// ============================================================
// HELPERS
// ============================================================
const slugify = (text) =>
  text.toString().toLowerCase().trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 200);

const generateToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );

const authRequired = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Authentication required" });
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

const calculateReadTime = (content) => {
  const words = content.replace(/<[^>]+>/g, "").split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
};

// ============================================================
// 🔐 AUTH ROUTES
// ============================================================

// POST /api/auth/register
router.post("/auth/register", asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: "Name, email and password required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be 6+ characters" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "Invalid email format" });

  const emailExists = await exists("users", "email = ?", [email]);
  if (emailExists) return res.status(409).json({ error: "Email already registered" });

  const hash = await bcrypt.hash(password, 10);
  const result = await query(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
    [name, email, hash, "author"]
  );

  const user = await getById("users", result.insertId);
  delete user.password_hash;
  res.status(201).json({ user, token: generateToken(user) });
}));

// POST /api/auth/login
router.post("/auth/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const [user] = await query("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  delete user.password_hash;
  res.json({ user, token: generateToken(user) });
}));

// GET /api/auth/me
router.get("/auth/me", authRequired, asyncHandler(async (req, res) => {
  const [user] = await query(
    "SELECT id, name, email, role, bio, avatar_url, website, twitter, linkedin FROM users WHERE id = ?",
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
}));

// PUT /api/auth/profile
router.put("/auth/profile", authRequired, asyncHandler(async (req, res) => {
  const { name, bio, website, twitter, linkedin } = req.body;
  await query(
    "UPDATE users SET name = ?, bio = ?, website = ?, twitter = ?, linkedin = ? WHERE id = ?",
    [name, bio || null, website || null, twitter || null, linkedin || null, req.user.id]
  );
  res.json({ message: "Profile updated" });
}));

// PUT /api/auth/password
router.put("/auth/password", authRequired, asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: "Both passwords required" });
  if (new_password.length < 6)
    return res.status(400).json({ error: "Password must be 6+ characters" });

  const user = await getById("users", req.user.id);
  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Current password wrong" });

  const hash = await bcrypt.hash(new_password, 10);
  await query("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.user.id]);
  res.json({ message: "Password updated" });
}));

// POST /api/auth/avatar — upload publisher photo
router.post("/auth/avatar", authRequired, uploadAvatar.single("avatar"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const user = await getById("users", req.user.id);
    if (user.avatar_public_id) {
      await deleteFromCloudinary(user.avatar_public_id).catch(() => {});
    }

    await query(
      "UPDATE users SET avatar_url = ?, avatar_public_id = ? WHERE id = ?",
      [req.file.path, req.file.filename, req.user.id]
    );
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

// ============================================================
// 📝 POSTS ROUTES
// ============================================================

// GET /api/posts — public list
router.get("/posts", asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 9;
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
    where.push(`p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.slug = ?)`);
    params.push(tag);
  }

  const whereSQL = "WHERE " + where.join(" AND ");

  const baseSQL = `
    SELECT p.id, p.title, p.slug, p.excerpt, p.cover_image, p.views,
           p.read_time, p.featured, p.published_at, p.created_at,
           u.id AS author_id, u.name AS author_name, u.avatar_url AS author_avatar,
           c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
           c.color AS category_color,
           (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND status = 'approved') AS comment_count
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereSQL}
    ORDER BY p.published_at DESC, p.id DESC
  `;

  const result = await paginate(baseSQL, params, page, limit);
  res.json({ posts: result.data, pagination: result.pagination });
}));

// GET /api/posts/featured
router.get("/posts/featured", asyncHandler(async (req, res) => {
  const posts = await query(`
    SELECT p.id, p.title, p.slug, p.excerpt, p.cover_image,
           u.name AS author_name, u.avatar_url AS author_avatar,
           c.name AS category_name, c.slug AS category_slug, c.color AS category_color
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published' AND p.featured = TRUE
    ORDER BY p.published_at DESC
    LIMIT 5
  `);
  res.json(posts);
}));

// GET /api/posts/admin/all
router.get("/posts/admin/all", authRequired, asyncHandler(async (req, res) => {
  let where = "";
  const params = [];

  if (req.user.role !== "admin") {
    where = "WHERE p.author_id = ?";
    params.push(req.user.id);
  }

  const posts = await query(`
    SELECT p.*, u.name AS author_name, c.name AS category_name,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
           (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    ${where}
    ORDER BY p.created_at DESC
  `, params);
  res.json(posts);
}));

// GET /api/posts/id/:id — for editing
router.get("/posts/id/:id", authRequired, asyncHandler(async (req, res) => {
  const [post] = await query(`
    SELECT p.*, u.name AS author_name, c.name AS category_name
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = ?
  `, [req.params.id]);

  if (!post) return res.status(404).json({ error: "Post not found" });
  if (post.author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized" });

  const tags = await query(`
    SELECT t.id, t.name, t.slug FROM tags t
    JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ?
  `, [post.id]);
  post.tags = tags;

  res.json(post);
}));

// GET /api/posts/:slug — public single post
router.get("/posts/:slug", asyncHandler(async (req, res) => {
  const [post] = await query(`
    SELECT p.*,
           u.id AS author_id, u.name AS author_name,
           u.bio AS author_bio, u.avatar_url AS author_avatar,
           u.website AS author_website, u.twitter AS author_twitter,
           u.linkedin AS author_linkedin,
           c.id AS category_id, c.name AS category_name,
           c.slug AS category_slug, c.color AS category_color,
           (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND status = 'approved') AS comment_count
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.slug = ? AND p.status = 'published'
  `, [req.params.slug]);

  if (!post) return res.status(404).json({ error: "Post not found" });

  query("UPDATE posts SET views = views + 1 WHERE id = ?", [post.id]).catch(() => {});

  const tags = await query(`
    SELECT t.id, t.name, t.slug FROM tags t
    JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ?
  `, [post.id]);
  post.tags = tags;

  const related = await query(`
    SELECT id, title, slug, cover_image, published_at FROM posts
    WHERE category_id = ? AND id != ? AND status = 'published'
    ORDER BY published_at DESC LIMIT 3
  `, [post.category_id, post.id]);
  post.related = related;

  res.json(post);
}));

// POST /api/posts — create
router.post("/posts", authRequired, asyncHandler(async (req, res) => {
  const {
    title, excerpt, content, cover_image, cover_public_id,
    category_id, status = "draft", featured = false,
    meta_title, meta_description, meta_keywords, tags = []
  } = req.body;

  if (!title || !content)
    return res.status(400).json({ error: "Title and content required" });

  let slug = slugify(title);
  const slugExists = await exists("posts", "slug = ?", [slug]);
  if (slugExists) slug = `${slug}-${Date.now()}`;

  const published_at = status === "published" ? new Date() : null;
  const read_time = calculateReadTime(content);

  const result = await query(`
    INSERT INTO posts
    (title, slug, excerpt, content, cover_image, cover_public_id,
     author_id, category_id, status, featured, read_time,
     meta_title, meta_description, meta_keywords, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    title, slug, excerpt || null, content, cover_image || null,
    cover_public_id || null, req.user.id, category_id || null,
    status, featured ? 1 : 0, read_time,
    meta_title || null, meta_description || null, meta_keywords || null,
    published_at
  ]);

  // Save tags
  if (Array.isArray(tags) && tags.length) {
    for (const tagName of tags) {
      const trimmed = String(tagName).trim();
      if (!trimmed) continue;
      const tagSlug = slugify(trimmed);
      await query("INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)", [trimmed, tagSlug]);
      const [tag] = await query("SELECT id FROM tags WHERE slug = ?", [tagSlug]);
      if (tag) {
        await query("INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
          [result.insertId, tag.id]);
      }
    }
  }

  res.status(201).json({ id: result.insertId, slug, message: "Post created" });
}));

// PUT /api/posts/:id — update
router.put("/posts/:id", authRequired, asyncHandler(async (req, res) => {
  const [existing] = await query("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Post not found" });
  if (existing.author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized" });

  const {
    title, excerpt, content, cover_image, cover_public_id,
    category_id, status, featured, meta_title, meta_description,
    meta_keywords, tags = []
  } = req.body;

  // Delete old cover if replaced
  if (existing.cover_public_id && cover_public_id &&
      existing.cover_public_id !== cover_public_id) {
    await deleteFromCloudinary(existing.cover_public_id).catch(() => {});
  }

  const published_at = (status === "published" && !existing.published_at)
    ? new Date() : existing.published_at;
  const read_time = calculateReadTime(content);

  await query(`
    UPDATE posts SET
      title = ?, excerpt = ?, content = ?, cover_image = ?, cover_public_id = ?,
      category_id = ?, status = ?, featured = ?, read_time = ?,
      meta_title = ?, meta_description = ?, meta_keywords = ?, published_at = ?
    WHERE id = ?
  `, [
    title, excerpt || null, content, cover_image || null, cover_public_id || null,
    category_id || null, status, featured ? 1 : 0, read_time,
    meta_title || null, meta_description || null, meta_keywords || null,
    published_at, req.params.id
  ]);

  // Refresh tags
  await query("DELETE FROM post_tags WHERE post_id = ?", [req.params.id]);
  if (Array.isArray(tags) && tags.length) {
    for (const tagName of tags) {
      const trimmed = String(tagName).trim();
      if (!trimmed) continue;
      const tagSlug = slugify(trimmed);
      await query("INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)", [trimmed, tagSlug]);
      const [tag] = await query("SELECT id FROM tags WHERE slug = ?", [tagSlug]);
      if (tag) {
        await query("INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
          [req.params.id, tag.id]);
      }
    }
  }

  res.json({ message: "Post updated" });
}));

// DELETE /api/posts/:id
router.delete("/posts/:id", authRequired, asyncHandler(async (req, res) => {
  const [existing] = await query("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Post not found" });
  if (existing.author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized" });

  if (existing.cover_public_id) {
    await deleteFromCloudinary(existing.cover_public_id).catch(() => {});
  }

  await query("DELETE FROM posts WHERE id = ?", [req.params.id]);
  res.json({ message: "Post deleted" });
}));

// ============================================================
// ❤️ LIKES
// ============================================================
router.post("/posts/:postId/like", asyncHandler(async (req, res) => {
  const ip = req.ip;
  const [existing] = await query(
    "SELECT id FROM likes WHERE post_id = ? AND user_ip = ?",
    [req.params.postId, ip]
  );

  if (existing) {
    await query("DELETE FROM likes WHERE id = ?", [existing.id]);
    const [[c]] = await query("SELECT COUNT(*) AS c FROM likes WHERE post_id = ?", [req.params.postId]);
    return res.json({ liked: false, count: c.c });
  }

  await query("INSERT INTO likes (post_id, user_ip) VALUES (?, ?)", [req.params.postId, ip]);
  const [[c]] = await query("SELECT COUNT(*) AS c FROM likes WHERE post_id = ?", [req.params.postId]);
  res.json({ liked: true, count: c.c });
}));

// ============================================================
// 💬 COMMENTS
// ============================================================
router.get("/posts/:postId/comments", asyncHandler(async (req, res) => {
  const rows = await query(`
    SELECT id, parent_id, author_name, content, created_at
    FROM comments
    WHERE post_id = ? AND status = 'approved'
    ORDER BY created_at ASC
  `, [req.params.postId]);

  const map = {}, roots = [];
  rows.forEach(c => { c.replies = []; map[c.id] = c; });
  rows.forEach(c => {
    if (c.parent_id && map[c.parent_id]) map[c.parent_id].replies.push(c);
    else roots.push(c);
  });

  res.json(roots);
}));

router.post("/posts/:postId/comments", asyncHandler(async (req, res) => {
  const { author_name, author_email, content, parent_id } = req.body;
  if (!author_name || !author_email || !content)
    return res.status(400).json({ error: "All fields required" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author_email))
    return res.status(400).json({ error: "Invalid email" });
  if (content.length < 3 || content.length > 5000)
    return res.status(400).json({ error: "Comment 3-5000 chars" });

  const postExists = await exists("posts", "id = ? AND status = 'published'", [req.params.postId]);
  if (!postExists) return res.status(404).json({ error: "Post not found" });

  const result = await query(`
    INSERT INTO comments (post_id, parent_id, author_name, author_email, content, author_ip, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `, [req.params.postId, parent_id || null, author_name.trim(), author_email.trim(), content.trim(), req.ip]);

  res.status(201).json({ id: result.insertId, message: "Comment submitted for moderation" });
}));

router.get("/comments", authRequired, asyncHandler(async (req, res) => {
  const rows = await query(`
    SELECT c.*, p.title AS post_title, p.slug AS post_slug
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    ORDER BY c.created_at DESC
  `);
  res.json(rows);
}));

router.put("/comments/:id", authRequired, asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!["pending", "approved", "spam"].includes(status))
    return res.status(400).json({ error: "Invalid status" });
  await query("UPDATE comments SET status = ? WHERE id = ?", [status, req.params.id]);
  res.json({ message: "Comment updated" });
}));

router.delete("/comments/:id", authRequired, asyncHandler(async (req, res) => {
  await query("DELETE FROM comments WHERE id = ?", [req.params.id]);
  res.json({ message: "Comment deleted" });
}));

// ============================================================
// 📤 UPLOAD ROUTES (Cloudinary)
// ============================================================

// POST /api/upload/cover
router.post("/upload/cover", authRequired, uploadBlogCover.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({
      url: req.file.path,
      public_id: req.file.filename,
      width: req.file.width,
      height: req.file.height
    });
  })
);

// POST /api/upload/content — for editor images
router.post("/upload/content", authRequired, uploadBlogContent.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({
      url: req.file.path,
      public_id: req.file.filename,
      width: req.file.width,
      height: req.file.height
    });
  })
);

// POST /api/upload/avatar
router.post("/upload/avatar", authRequired, uploadAvatar.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

// POST /api/upload/file — documents
router.post("/upload/file", authRequired, uploadBlogFile.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({
      url: req.file.path,
      public_id: req.file.filename,
      size: req.file.size,
      format: req.file.format
    });
  })
);

// POST /api/upload/base64 — paste in editor
router.post("/upload/base64", authRequired, asyncHandler(async (req, res) => {
  const { image, folder } = req.body;
  if (!image) return res.status(400).json({ error: "No image data" });

  const result = await uploadBase64(image, folder || "blog/content");
  res.json(result);
}));

// DELETE /api/upload/:publicId — delete from Cloudinary
router.delete("/upload/:publicId(*)", authRequired, asyncHandler(async (req, res) => {
  const { resource_type } = req.query;
  await deleteFromCloudinary(req.params.publicId, resource_type || "image");
  res.json({ message: "Deleted from Cloudinary" });
}));

// ============================================================
// 📂 CATEGORIES
// ============================================================
router.get("/categories", asyncHandler(async (req, res) => {
  const rows = await query(`
    SELECT c.*, COUNT(p.id) AS post_count
    FROM categories c
    LEFT JOIN posts p ON p.category_id = c.id AND p.status = 'published'
    GROUP BY c.id
    ORDER BY c.name
  `);
  res.json(rows);
}));

router.post("/categories", authRequired, adminOnly, asyncHandler(async (req, res) => {
  const { name, description, color } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const slug = slugify(name);
  try {
    const result = await query(
      "INSERT INTO categories (name, slug, description, color) VALUES (?, ?, ?, ?)",
      [name, slug, description || null, color || "#6366f1"]
    );
    res.status(201).json({ id: result.insertId, slug });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "Category already exists" });
    throw e;
  }
}));

router.put("/categories/:id", authRequired, adminOnly, asyncHandler(async (req, res) => {
  const { name, description, color } = req.body;
  const slug = slugify(name);
  await query(
    "UPDATE categories SET name = ?, slug = ?, description = ?, color = ? WHERE id = ?",
    [name, slug, description || null, color || "#6366f1", req.params.id]
  );
  res.json({ message: "Category updated" });
}));

router.delete("/categories/:id", authRequired, adminOnly, asyncHandler(async (req, res) => {
  await query("DELETE FROM categories WHERE id = ?", [req.params.id]);
  res.json({ message: "Category deleted" });
}));

// ============================================================
// 🏷️ TAGS
// ============================================================
router.get("/tags", asyncHandler(async (req, res) => {
  const rows = await query(`
    SELECT t.id, t.name, t.slug, COUNT(pt.post_id) AS post_count
    FROM tags t
    LEFT JOIN post_tags pt ON pt.tag_id = t.id
    LEFT JOIN posts p ON p.id = pt.post_id AND p.status = 'published'
    GROUP BY t.id
    ORDER BY post_count DESC
    LIMIT 30
  `);
  res.json(rows);
}));

// ============================================================
// 📧 NEWSLETTER
// ============================================================
router.post("/subscribe", asyncHandler(async (req, res) => {
  const { email, name } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "Valid email required" });

  await query(
    "INSERT IGNORE INTO subscribers (email, name, ip_address) VALUES (?, ?, ?)",
    [email.trim().toLowerCase(), name || null, req.ip]
  );
  res.json({ message: "Subscribed successfully" });
}));

router.get("/subscribers", authRequired, adminOnly, asyncHandler(async (req, res) => {
  const rows = await query(
    "SELECT id, email, name, status, created_at FROM subscribers ORDER BY created_at DESC"
  );
  res.json(rows);
}));

router.delete("/subscribers/:id", authRequired, adminOnly, asyncHandler(async (req, res) => {
  await query("DELETE FROM subscribers WHERE id = ?", [req.params.id]);
  res.json({ message: "Subscriber removed" });
}));

// ============================================================
// 📢 ADS
// ============================================================
router.get("/ads/:position", asyncHandler(async (req, res) => {
  const [ad] = await query(`
    SELECT id, name, position, type, content, image_url, link_url
    FROM ads
    WHERE position = ? AND is_active = TRUE
      AND (start_date IS NULL OR start_date <= CURDATE())
      AND (end_date IS NULL OR end_date >= CURDATE())
    ORDER BY RAND() LIMIT 1
  `, [req.params.position]);

  if (ad) {
    query("UPDATE ads SET impressions = impressions + 1 WHERE id = ?", [ad.id]).catch(() => {});
    return res.json(ad);
  }
  res.json(null);
}));

router.post("/ads/:id/click", asyncHandler(async (req, res) => {
  await query("UPDATE ads SET clicks = clicks + 1 WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

router.get("/ads", authRequired, asyncHandler(async (req, res) => {
  const rows = await query("SELECT * FROM ads ORDER BY created_at DESC");
  res.json(rows);
}));

router.post("/ads", authRequired, adminOnly, asyncHandler(async (req, res) => {
  const { name, position, type, content, image_url, link_url, start_date, end_date } = req.body;
  if (!name || !position || !type)
    return res.status(400).json({ error: "Name, position, type required" });

  const result = await query(`
    INSERT INTO ads (name, position, type, content, image_url, link_url, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [name, position, type, content || null, image_url || null, link_url || null,
      start_date || null, end_date || null]);

  res.status(201).json({ id: result.insertId });
}));

router.put("/ads/:id", authRequired, adminOnly, asyncHandler(async (req, res) => {
  const { name, position, type, content, image_url, link_url, is_active, start_date, end_date } = req.body;
  await query(`
    UPDATE ads SET name = ?, position = ?, type = ?, content = ?,
      image_url = ?, link_url = ?, is_active = ?, start_date = ?, end_date = ?
    WHERE id = ?
  `, [name, position, type, content || null, image_url || null, link_url || null,
      is_active ? 1 : 0, start_date || null, end_date || null, req.params.id]);
  res.json({ message: "Ad updated" });
}));

router.delete("/ads/:id", authRequired, adminOnly, asyncHandler(async (req, res) => {
  await query("DELETE FROM ads WHERE id = ?", [req.params.id]);
  res.json({ message: "Ad deleted" });
}));

// ============================================================
// 📊 SHARES (tracking)
// ============================================================
router.post("/posts/:postId/share", asyncHandler(async (req, res) => {
  const { platform } = req.body;
  if (!platform) return res.status(400).json({ error: "Platform required" });
  await query(
    "INSERT INTO shares (post_id, platform, user_ip) VALUES (?, ?, ?)",
    [req.params.postId, platform, req.ip]
  );
  res.json({ ok: true });
}));

// ============================================================
// 📊 STATS
// ============================================================
router.get("/stats", authRequired, asyncHandler(async (req, res) => {
  const [[posts]] = await query(`
    SELECT COUNT(*) AS total,
           SUM(status = 'published') AS published,
           SUM(status = 'draft') AS drafts,
           SUM(views) AS total_views
    FROM posts
  `);

  const [[comments]] = await query(`
    SELECT COUNT(*) AS total, SUM(status = 'pending') AS pending FROM comments
  `);

  const [[subs]] = await query("SELECT COUNT(*) AS total FROM subscribers");
  const [[likes]] = await query("SELECT COUNT(*) AS total FROM likes");
  const [[users]] = await query("SELECT COUNT(*) AS total FROM users");
  const [[ads]] = await query(`
    SELECT COUNT(*) AS total, SUM(impressions) AS impressions, SUM(clicks) AS clicks FROM ads
  `);

  res.json({ posts, comments, subscribers: subs.total, likes: likes.total, users: users.total, ads });
}));

// ============================================================
// ❤️ HEALTH CHECK
// ============================================================
router.get("/health", (req, res) => {
  res.json({ status: "ok", service: "blog-api", time: new Date().toISOString() });
});

module.exports = router;
