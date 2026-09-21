const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// ✅ Existing imports (school) — same rahenge
const { db, query, transaction, getById, count, exists, blogQuery } = require("../config/db");
const {
  cloudinary,
  // Existing school uploads (agar hain)
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
// EXISTING MIDDLEWARE (school wale)
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
// 🏫 SCHOOL ROUTES (aapke existing — yahan rahenge)
// ============================================================
// ... aapke saare school routes yahin rahenge (students, faculty, gallery, etc.)
// Main inhe nahi chhed raha, sirf blog add kar raha hoon niche

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
// 🔐 BLOG AUTH
// ═══════════════════════════════════════════════════════════

// POST /api/blog/auth/register
router.post("/blog/auth/register", blogAsync(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: "Name, email, password required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be 6+ characters" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "Invalid email format" });

  const existing = await blogQuery("SELECT id FROM users WHERE email = ?", [email]);
  if (existing.length) return res.status(409).json({ error: "Email already exists" });

  const hash = await bcrypt.hash(password, 10);
  const result = await blogQuery(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
    [name, email, hash, "author"]
  );

  const [user] = await blogQuery(
    "SELECT id, name, email, role FROM users WHERE id = ?",
    [result.insertId]
  );

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.status(201).json({ user, token });
}));

// POST /api/blog/auth/login
router.post("/blog/auth/login", blogAsync(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const [user] = await blogQuery("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  delete user.password_hash;
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ user, token });
}));

// GET /api/blog/auth/me
router.get("/blog/auth/me", authRequired, blogAsync(async (req, res) => {
  const [user] = await blogQuery(
    "SELECT id, name, email, role, bio, avatar_url, website, twitter, linkedin FROM users WHERE id = ?",
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
}));

// PUT /api/blog/auth/profile
router.put("/blog/auth/profile", authRequired, blogAsync(async (req, res) => {
  const { name, bio, website, twitter, linkedin } = req.body;
  await blogQuery(
    "UPDATE users SET name = ?, bio = ?, website = ?, twitter = ?, linkedin = ? WHERE id = ?",
    [name, bio || null, website || null, twitter || null, linkedin || null, req.user.id]
  );
  res.json({ message: "Profile updated" });
}));

// PUT /api/blog/auth/password
router.put("/blog/auth/password", authRequired, blogAsync(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: "Both passwords required" });
  if (new_password.length < 6)
    return res.status(400).json({ error: "Password must be 6+ characters" });

  const [user] = await blogQuery("SELECT * FROM users WHERE id = ?", [req.user.id]);
  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Current password wrong" });

  const hash = await bcrypt.hash(new_password, 10);
  await blogQuery("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.user.id]);
  res.json({ message: "Password updated" });
}));

// POST /api/blog/auth/avatar
router.post("/blog/auth/avatar", authRequired, uploadBlogAvatar.single("avatar"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const [user] = await blogQuery("SELECT avatar_public_id FROM users WHERE id = ?", [req.user.id]);
    if (user?.avatar_public_id) {
      await deleteBlogFromCloudinary(user.avatar_public_id).catch(() => {});
    }

    await blogQuery(
      "UPDATE users SET avatar_url = ?, avatar_public_id = ? WHERE id = ?",
      [req.file.path, req.file.filename, req.user.id]
    );
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

// ═══════════════════════════════════════════════════════════
// 📝 BLOG POSTS
// ═══════════════════════════════════════════════════════════

// GET /api/blog/posts — public list
router.get("/blog/posts", blogAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
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
    where.push(`p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.slug = ?)`);
    params.push(tag);
  }

  const whereSQL = "WHERE " + where.join(" AND ");

  const countResult = await blogQuery(`
    SELECT COUNT(*) AS total FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereSQL}
  `, params);
  const total = countResult[0].total;

  const posts = await blogQuery(`
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
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

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

// GET /api/blog/posts/admin/all
router.get("/blog/posts/admin/all", authRequired, blogAsync(async (req, res) => {
  let where = "";
  const params = [];
  if (req.user.role !== "admin") {
    where = "WHERE p.author_id = ?";
    params.push(req.user.id);
  }

  const posts = await blogQuery(`
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

// GET /api/blog/posts/id/:id
router.get("/blog/posts/id/:id", authRequired, blogAsync(async (req, res) => {
  const [post] = await blogQuery(`
    SELECT p.*, u.name AS author_name, c.name AS category_name
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = ?
  `, [req.params.id]);

  if (!post) return res.status(404).json({ error: "Post not found" });
  if (post.author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized" });

  const tags = await blogQuery(`
    SELECT t.id, t.name, t.slug FROM tags t
    JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ?
  `, [post.id]);
  post.tags = tags;

  res.json(post);
}));

// GET /api/blog/posts/:slug
router.get("/blog/posts/:slug", blogAsync(async (req, res) => {
  const [post] = await blogQuery(`
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

// POST /api/blog/posts
router.post("/blog/posts", authRequired, blogAsync(async (req, res) => {
  const {
    title, excerpt, content, cover_image, cover_public_id,
    category_id, status = "draft", featured = false,
    meta_title, meta_description, meta_keywords, tags = []
  } = req.body;

  if (!title || !content)
    return res.status(400).json({ error: "Title and content required" });

  let slug = blogSlugify(title);
  const existing = await blogQuery("SELECT id FROM posts WHERE slug = ?", [slug]);
  if (existing.length) slug = `${slug}-${Date.now()}`;

  const published_at = status === "published" ? new Date() : null;
  const read_time = calcReadTime(content);

  const result = await blogQuery(`
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

  if (Array.isArray(tags) && tags.length) {
    for (const tagName of tags) {
      const trimmed = String(tagName).trim();
      if (!trimmed) continue;
      const tagSlug = blogSlugify(trimmed);
      await blogQuery("INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)", [trimmed, tagSlug]);
      const [tag] = await blogQuery("SELECT id FROM tags WHERE slug = ?", [tagSlug]);
      if (tag) {
        await blogQuery("INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
          [result.insertId, tag.id]);
      }
    }
  }

  res.status(201).json({ id: result.insertId, slug, message: "Post created" });
}));

// PUT /api/blog/posts/:id
router.put("/blog/posts/:id", authRequired, blogAsync(async (req, res) => {
  const [existing] = await blogQuery("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!existing.length) return res.status(404).json({ error: "Post not found" });
  if (existing[0].author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized" });

  const old = existing[0];
  const {
    title, excerpt, content, cover_image, cover_public_id,
    category_id, status, featured, meta_title, meta_description,
    meta_keywords, tags = []
  } = req.body;

  if (old.cover_public_id && cover_public_id && old.cover_public_id !== cover_public_id) {
    await deleteBlogFromCloudinary(old.cover_public_id).catch(() => {});
  }

  const published_at = (status === "published" && !old.published_at)
    ? new Date() : old.published_at;
  const read_time = calcReadTime(content);

  await blogQuery(`
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

  await blogQuery("DELETE FROM post_tags WHERE post_id = ?", [req.params.id]);
  if (Array.isArray(tags) && tags.length) {
    for (const tagName of tags) {
      const trimmed = String(tagName).trim();
      if (!trimmed) continue;
      const tagSlug = blogSlugify(trimmed);
      await blogQuery("INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)", [trimmed, tagSlug]);
      const [tag] = await blogQuery("SELECT id FROM tags WHERE slug = ?", [tagSlug]);
      if (tag) {
        await blogQuery("INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
          [req.params.id, tag.id]);
      }
    }
  }

  res.json({ message: "Post updated" });
}));

// DELETE /api/blog/posts/:id
router.delete("/blog/posts/:id", authRequired, blogAsync(async (req, res) => {
  const [existing] = await blogQuery("SELECT * FROM posts WHERE id = ?", [req.params.id]);
  if (!existing.length) return res.status(404).json({ error: "Post not found" });
  if (existing[0].author_id !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorized" });

  if (existing[0].cover_public_id) {
    await deleteBlogFromCloudinary(existing[0].cover_public_id).catch(() => {});
  }

  await blogQuery("DELETE FROM posts WHERE id = ?", [req.params.id]);
  res.json({ message: "Post deleted" });
}));

// ═══════════════════════════════════════════════════════════
// ❤️ LIKES
// ═══════════════════════════════════════════════════════════
router.post("/blog/posts/:postId/like", blogAsync(async (req, res) => {
  const ip = req.ip;
  const existing = await blogQuery(
    "SELECT id FROM likes WHERE post_id = ? AND user_ip = ?",
    [req.params.postId, ip]
  );

  if (existing.length) {
    await blogQuery("DELETE FROM likes WHERE id = ?", [existing[0].id]);
    const c = await blogQuery("SELECT COUNT(*) AS c FROM likes WHERE post_id = ?", [req.params.postId]);
    return res.json({ liked: false, count: c[0].c });
  }

  await blogQuery("INSERT INTO likes (post_id, user_ip) VALUES (?, ?)", [req.params.postId, ip]);
  const c = await blogQuery("SELECT COUNT(*) AS c FROM likes WHERE post_id = ?", [req.params.postId]);
  res.json({ liked: true, count: c[0].c });
}));

// ═══════════════════════════════════════════════════════════
// 💬 COMMENTS
// ═══════════════════════════════════════════════════════════
router.get("/blog/posts/:postId/comments", blogAsync(async (req, res) => {
  const rows = await blogQuery(`
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

router.post("/blog/posts/:postId/comments", blogAsync(async (req, res) => {
  const { author_name, author_email, content, parent_id } = req.body;
  if (!author_name || !author_email || !content)
    return res.status(400).json({ error: "All fields required" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author_email))
    return res.status(400).json({ error: "Invalid email" });
  if (content.length < 3 || content.length > 5000)
    return res.status(400).json({ error: "Comment 3-5000 chars" });

  const post = await blogQuery(
    "SELECT id FROM posts WHERE id = ? AND status = 'published'",
    [req.params.postId]
  );
  if (!post.length) return res.status(404).json({ error: "Post not found" });

  const result = await blogQuery(`
    INSERT INTO comments (post_id, parent_id, author_name, author_email, content, author_ip, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `, [req.params.postId, parent_id || null, author_name.trim(),
      author_email.trim(), content.trim(), req.ip]);

  res.status(201).json({ id: result.insertId, message: "Comment submitted for moderation" });
}));

router.get("/blog/comments", authRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT c.*, p.title AS post_title, p.slug AS post_slug
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    ORDER BY c.created_at DESC
  `);
  res.json(rows);
}));

router.put("/blog/comments/:id", authRequired, blogAsync(async (req, res) => {
  const { status } = req.body;
  if (!["pending", "approved", "spam"].includes(status))
    return res.status(400).json({ error: "Invalid status" });
  await blogQuery("UPDATE comments SET status = ? WHERE id = ?", [status, req.params.id]);
  res.json({ message: "Comment updated" });
}));

router.delete("/blog/comments/:id", authRequired, blogAsync(async (req, res) => {
  await blogQuery("DELETE FROM comments WHERE id = ?", [req.params.id]);
  res.json({ message: "Comment deleted" });
}));

// ═══════════════════════════════════════════════════════════
// 📤 BLOG UPLOADS (Cloudinary)
// ═══════════════════════════════════════════════════════════
router.post("/blog/upload/cover", authRequired, uploadBlogCover.single("file"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

router.post("/blog/upload/content", authRequired, uploadBlogContent.single("file"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

router.post("/blog/upload/avatar", authRequired, uploadBlogAvatar.single("file"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: req.file.path, public_id: req.file.filename });
  })
);

router.post("/blog/upload/file", authRequired, uploadBlogFile.single("file"),
  blogAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    res.json({ url: req.file.path, public_id: req.file.filename, size: req.file.size });
  })
);

router.post("/blog/upload/base64", authRequired, blogAsync(async (req, res) => {
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

router.post("/blog/categories", authRequired, blogAsync(async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admin required" });

  const { name, description, color } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const slug = blogSlugify(name);
  try {
    const result = await blogQuery(
      "INSERT INTO categories (name, slug, description, color) VALUES (?, ?, ?, ?)",
      [name, slug, description || null, color || "#6366f1"]
    );
    res.status(201).json({ id: result.insertId, slug });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Category exists" });
    throw e;
  }
}));

router.put("/blog/categories/:id", authRequired, blogAsync(async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admin required" });
  const { name, description, color } = req.body;
  const slug = blogSlugify(name);
  await blogQuery(
    "UPDATE categories SET name = ?, slug = ?, description = ?, color = ? WHERE id = ?",
    [name, slug, description || null, color || "#6366f1", req.params.id]
  );
  res.json({ message: "Category updated" });
}));

router.delete("/blog/categories/:id", authRequired, blogAsync(async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admin required" });
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

router.get("/blog/subscribers", authRequired, blogAsync(async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admin required" });
  const rows = await blogQuery(
    "SELECT id, email, name, status, created_at FROM subscribers ORDER BY created_at DESC"
  );
  res.json(rows);
}));

router.delete("/blog/subscribers/:id", authRequired, blogAsync(async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admin required" });
  await blogQuery("DELETE FROM subscribers WHERE id = ?", [req.params.id]);
  res.json({ message: "Subscriber removed" });
}));

// ═══════════════════════════════════════════════════════════
// 📢 ADS
// ═══════════════════════════════════════════════════════════
router.get("/blog/ads/:position", blogAsync(async (req, res) => {
  const rows = await blogQuery(`
    SELECT id, name, position, type, content, image_url, link_url
    FROM ads
    WHERE position = ? AND is_active = TRUE
    ORDER BY RAND() LIMIT 1
  `, [req.params.position]);

  if (rows.length) {
    blogQuery("UPDATE ads SET impressions = impressions + 1 WHERE id = ?", [rows[0].id]).catch(() => {});
    return res.json(rows[0]);
  }
  res.json(null);
}));

router.post("/blog/ads/:id/click", blogAsync(async (req, res) => {
  await blogQuery("UPDATE ads SET clicks = clicks + 1 WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

router.get("/blog/ads", authRequired, blogAsync(async (req, res) => {
  const rows = await blogQuery("SELECT * FROM ads ORDER BY created_at DESC");
  res.json(rows);
}));

router.post("/blog/ads", authRequired, blogAsync(async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admin required" });

  const { name, position, type, content, image_url, link_url } = req.body;
  if (!name || !position || !type)
    return res.status(400).json({ error: "Required fields missing" });

  const result = await blogQuery(`
    INSERT INTO ads (name, position, type, content, image_url, link_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [name, position, type, content || null, image_url || null, link_url || null]);

  res.status(201).json({ id: result.insertId });
}));

router.put("/blog/ads/:id", authRequired, blogAsync(async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admin required" });
  const { name, position, type, content, image_url, link_url, is_active } = req.body;
  await blogQuery(`
    UPDATE ads SET name=?, position=?, type=?, content=?, image_url=?, link_url=?, is_active=?
    WHERE id=?
  `, [name, position, type, content || null, image_url || null, link_url || null,
      is_active ? 1 : 0, req.params.id]);
  res.json({ message: "Ad updated" });
}));

router.delete("/blog/ads/:id", authRequired, blogAsync(async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admin required" });
  await blogQuery("DELETE FROM ads WHERE id = ?", [req.params.id]);
  res.json({ message: "Ad deleted" });
}));

// ═══════════════════════════════════════════════════════════
// 📊 SHARES (tracking)
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
// 📊 BLOG STATS
// ═══════════════════════════════════════════════════════════
router.get("/blog/stats", authRequired, blogAsync(async (req, res) => {
  const posts = await blogQuery(`
    SELECT COUNT(*) AS total,
           SUM(status = 'published') AS published,
           SUM(status = 'draft') AS drafts,
           SUM(views) AS total_views
    FROM posts
  `);

  const comments = await blogQuery(`
    SELECT COUNT(*) AS total, SUM(status = 'pending') AS pending FROM comments
  `);

  const subs = await blogQuery("SELECT COUNT(*) AS total FROM subscribers");
  const likes = await blogQuery("SELECT COUNT(*) AS total FROM likes");
  const users = await blogQuery("SELECT COUNT(*) AS total FROM users");
  const ads = await blogQuery(`
    SELECT COUNT(*) AS total, SUM(impressions) AS impressions, SUM(clicks) AS clicks FROM ads
  `);

  res.json({
    posts: posts[0],
    comments: comments[0],
    subscribers: subs[0].total,
    likes: likes[0].total,
    users: users[0].total,
    ads: ads[0]
  });
}));

// ============================================================
// EXPORT (school + blog dono)
// ============================================================
module.exports = router;
