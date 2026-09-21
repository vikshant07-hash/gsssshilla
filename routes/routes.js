const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require("../config/db");


const router = express.Router();

// ============================================================
// UPLOAD SETUP
// ============================================================
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase())
            && allowed.test(file.mimetype);
    cb(ok ? null : new Error('Only images allowed'), ok);
  }
});

// ============================================================
// HELPERS
// ============================================================
const slugify = (text) =>
  text.toString().toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

const generateToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

const authRequired = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
};

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ============================================================
// 🔐 AUTH ROUTES
// ============================================================

// POST /api/auth/register
router.post('/auth/register', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, hash, 'author']
  );

  const [rows] = await pool.query(
    'SELECT id, name, email, role FROM users WHERE id = ?',
    [result.insertId]
  );
  res.status(201).json({ user: rows[0], token: generateToken(rows[0]) });
}));

// POST /api/auth/login
router.post('/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  delete user.password_hash;
  res.json({ user, token: generateToken(user) });
}));

// GET /api/auth/me
router.get('/auth/me', authRequired, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, email, role, bio, avatar_url FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
}));

// ============================================================
// 📝 POSTS ROUTES
// ============================================================

// GET /api/posts — public list with pagination + filters
router.get('/posts', asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 9, 50);
  const offset = (page - 1) * limit;
  const { category, tag, author, search } = req.query;

  const where = ["p.status = 'published'"];
  const params = [];

  if (category) { where.push('c.slug = ?'); params.push(category); }
  if (author)   { where.push('p.author_id = ?'); params.push(author); }
  if (search) {
    where.push('(p.title LIKE ? OR p.excerpt LIKE ? OR p.content LIKE ?)');
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

  const whereSQL = 'WHERE ' + where.join(' AND ');

  const [countR] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM posts p
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereSQL}`,
    params
  );
  const total = countR[0].total;

  const [posts] = await pool.query(
    `SELECT p.id, p.title, p.slug, p.excerpt, p.cover_image, p.views,
            p.published_at, p.created_at,
            u.id AS author_id, u.name AS author_name, u.avatar_url AS author_avatar,
            c.id AS category_id, c.name AS category_name, c.slug AS category_slug
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
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
}));

// GET /api/posts/admin/all — admin: all posts (incl. drafts)
router.get('/posts/admin/all', authRequired, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, u.name AS author_name, c.name AS category_name
     FROM posts p
     JOIN users u ON u.id = p.author_id
     LEFT JOIN categories c ON c.id = p.category_id
     ORDER BY p.created_at DESC`
  );
  res.json(rows);
}));

// GET /api/posts/:slug — public single post
router.get('/posts/:slug', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*,
            u.id AS author_id, u.name AS author_name,
            u.bio AS author_bio, u.avatar_url AS author_avatar,
            c.id AS category_id, c.name AS category_name, c.slug AS category_slug
     FROM posts p
     JOIN users u ON u.id = p.author_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.slug = ? AND p.status = 'published'`,
    [req.params.slug]
  );

  if (!rows.length) return res.status(404).json({ error: 'Post not found' });
  const post = rows[0];

  // Increment views (fire-and-forget)
  pool.query('UPDATE posts SET views = views + 1 WHERE id = ?', [post.id]).catch(() => {});

  // Tags
  const [tags] = await pool.query(
    `SELECT t.id, t.name, t.slug
     FROM tags t
     JOIN post_tags pt ON pt.tag_id = t.id
     WHERE pt.post_id = ?`,
    [post.id]
  );
  post.tags = tags;

  // Related posts (same category)
  const [related] = await pool.query(
    `SELECT id, title, slug, cover_image, published_at
     FROM posts
     WHERE category_id = ? AND id != ? AND status = 'published'
     ORDER BY published_at DESC LIMIT 3`,
    [post.category_id, post.id]
  );
  post.related = related;

  res.json(post);
}));

// POST /api/posts — admin/author: create
router.post('/posts', authRequired, asyncHandler(async (req, res) => {
  const {
    title, excerpt, content, cover_image, category_id,
    status = 'draft', meta_title, meta_description, tags = []
  } = req.body;

  if (!title || !content)
    return res.status(400).json({ error: 'Title and content required' });

  let slug = slugify(title);
  const [existing] = await pool.query('SELECT id FROM posts WHERE slug = ?', [slug]);
  if (existing.length) slug = `${slug}-${Date.now()}`;

  const published_at = status === 'published' ? new Date() : null;

  const [result] = await pool.query(
    `INSERT INTO posts
     (title, slug, excerpt, content, cover_image, author_id,
      category_id, status, meta_title, meta_description, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title, slug, excerpt || null, content, cover_image || null,
      req.user.id, category_id || null, status,
      meta_title || null, meta_description || null, published_at
    ]
  );

  // Save tags
  if (Array.isArray(tags) && tags.length) {
    for (const tagName of tags) {
      const trimmed = String(tagName).trim();
      if (!trimmed) continue;
      const tagSlug = slugify(trimmed);
      await pool.query(
        'INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)',
        [trimmed, tagSlug]
      );
      const [tagRow] = await pool.query('SELECT id FROM tags WHERE slug = ?', [tagSlug]);
      if (tagRow.length) {
        await pool.query(
          'INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)',
          [result.insertId, tagRow[0].id]
        );
      }
    }
  }

  res.status(201).json({
    id: result.insertId,
    slug,
    message: 'Post created successfully'
  });
}));

// PUT /api/posts/:id — admin/author: update
router.put('/posts/:id', authRequired, asyncHandler(async (req, res) => {
  const [existing] = await pool.query('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  if (!existing.length) return res.status(404).json({ error: 'Post not found' });

  const post = existing[0];
  if (post.author_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Not authorized' });

  const {
    title, excerpt, content, cover_image, category_id,
    status, meta_title, meta_description, tags = []
  } = req.body;

  const published_at = (status === 'published' && !post.published_at)
    ? new Date()
    : post.published_at;

  await pool.query(
    `UPDATE posts SET
      title = ?, excerpt = ?, content = ?, cover_image = ?,
      category_id = ?, status = ?, meta_title = ?,
      meta_description = ?, published_at = ?
     WHERE id = ?`,
    [
      title, excerpt || null, content, cover_image || null,
      category_id || null, status, meta_title || null,
      meta_description || null, published_at, req.params.id
    ]
  );

  // Refresh tags
  await pool.query('DELETE FROM post_tags WHERE post_id = ?', [req.params.id]);
  if (Array.isArray(tags) && tags.length) {
    for (const tagName of tags) {
      const trimmed = String(tagName).trim();
      if (!trimmed) continue;
      const tagSlug = slugify(trimmed);
      await pool.query(
        'INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)',
        [trimmed, tagSlug]
      );
      const [tagRow] = await pool.query('SELECT id FROM tags WHERE slug = ?', [tagSlug]);
      if (tagRow.length) {
        await pool.query(
          'INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)',
          [req.params.id, tagRow[0].id]
        );
      }
    }
  }

  res.json({ message: 'Post updated successfully' });
}));

// DELETE /api/posts/:id — admin/author: delete
router.delete('/posts/:id', authRequired, asyncHandler(async (req, res) => {
  const [existing] = await pool.query(
    'SELECT author_id FROM posts WHERE id = ?',
    [req.params.id]
  );
  if (!existing.length) return res.status(404).json({ error: 'Post not found' });

  if (existing[0].author_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Not authorized' });

  await pool.query('DELETE FROM posts WHERE id = ?', [req.params.id]);
  res.json({ message: 'Post deleted successfully' });
}));

// ============================================================
// 📂 CATEGORIES ROUTES
// ============================================================

// GET /api/categories — public
router.get('/categories', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*, COUNT(p.id) AS post_count
     FROM categories c
     LEFT JOIN posts p ON p.category_id = c.id AND p.status = 'published'
     GROUP BY c.id
     ORDER BY c.name ASC`
  );
  res.json(rows);
}));

// POST /api/categories — admin
router.post('/categories', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const slug = slugify(name);
  try {
    const [result] = await pool.query(
      'INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)',
      [name, slug, description || null]
    );
    res.status(201).json({
      id: result.insertId,
      slug,
      message: 'Category created'
    });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Category already exists' });
    throw e;
  }
}));

// PUT /api/categories/:id — admin
router.put('/categories/:id', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const slug = slugify(name);
  await pool.query(
    'UPDATE categories SET name = ?, slug = ?, description = ? WHERE id = ?',
    [name, slug, description || null, req.params.id]
  );
  res.json({ message: 'Category updated' });
}));

// DELETE /api/categories/:id — admin
router.delete('/categories/:id', authRequired, adminOnly, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
  res.json({ message: 'Category deleted' });
}));

// ============================================================
// 🏷️ TAGS ROUTES
// ============================================================

// GET /api/tags — public popular tags
router.get('/tags', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.id, t.name, t.slug, COUNT(pt.post_id) AS post_count
     FROM tags t
     LEFT JOIN post_tags pt ON pt.tag_id = t.id
     LEFT JOIN posts p ON p.id = pt.post_id AND p.status = 'published'
     GROUP BY t.id
     ORDER BY post_count DESC
     LIMIT 30`
  );
  res.json(rows);
}));

// ============================================================
// 💬 COMMENTS ROUTES
// ============================================================

// GET /api/posts/:postId/comments — public approved (nested)
router.get('/posts/:postId/comments', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, parent_id, author_name, content, created_at
     FROM comments
     WHERE post_id = ? AND status = 'approved'
     ORDER BY created_at ASC`,
    [req.params.postId]
  );

  // Build nested tree
  const map = {};
  const roots = [];
  rows.forEach(c => { c.replies = []; map[c.id] = c; });
  rows.forEach(c => {
    if (c.parent_id && map[c.parent_id]) map[c.parent_id].replies.push(c);
    else roots.push(c);
  });

  res.json(roots);
}));

// POST /api/posts/:postId/comments — public create
router.post('/posts/:postId/comments', asyncHandler(async (req, res) => {
  const { author_name, author_email, content, parent_id } = req.body;

  if (!author_name || !author_email || !content)
    return res.status(400).json({ error: 'All fields required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author_email))
    return res.status(400).json({ error: 'Invalid email' });
  if (content.length < 3 || content.length > 5000)
    return res.status(400).json({ error: 'Comment length must be 3–5000 chars' });

  // Verify post exists
  const [post] = await pool.query(
    'SELECT id FROM posts WHERE id = ? AND status = "published"',
    [req.params.postId]
  );
  if (!post.length) return res.status(404).json({ error: 'Post not found' });

  const [result] = await pool.query(
    `INSERT INTO comments
     (post_id, parent_id, author_name, author_email, content, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [req.params.postId, parent_id || null, author_name.trim(), author_email.trim(), content.trim()]
  );

  res.status(201).json({
    id: result.insertId,
    message: 'Comment submitted for moderation'
  });
}));

// GET /api/comments — admin: all comments
router.get('/comments', authRequired, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*, p.title AS post_title, p.slug AS post_slug
     FROM comments c
     JOIN posts p ON p.id = c.post_id
     ORDER BY c.created_at DESC`
  );
  res.json(rows);
}));

// PUT /api/comments/:id — admin: approve/spam
router.put('/comments/:id', authRequired, asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'spam'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });

  await pool.query('UPDATE comments SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ message: 'Comment updated' });
}));

// DELETE /api/comments/:id — admin
router.delete('/comments/:id', authRequired, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM comments WHERE id = ?', [req.params.id]);
  res.json({ message: 'Comment deleted' });
}));

// ============================================================
// 📧 NEWSLETTER ROUTES
// ============================================================

// POST /api/subscribe — public
router.post('/subscribe', asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Valid email required' });

  await pool.query('INSERT IGNORE INTO subscribers (email) VALUES (?)', [email.trim().toLowerCase()]);
  res.json({ message: 'Subscribed successfully' });
}));

// GET /api/subscribers — admin
router.get('/subscribers', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, email, created_at FROM subscribers ORDER BY created_at DESC'
  );
  res.json(rows);
}));

// DELETE /api/subscribers/:id — admin
router.delete('/subscribers/:id', authRequired, adminOnly, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM subscribers WHERE id = ?', [req.params.id]);
  res.json({ message: 'Subscriber removed' });
}));

// ============================================================
// 📢 ADS ROUTES
// ============================================================

// GET /api/ads/:position — public: get one active ad
router.get('/ads/:position', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, position, type, content, image_url, link_url
     FROM ads
     WHERE position = ? AND is_active = TRUE
     ORDER BY RAND()
     LIMIT 1`,
    [req.params.position]
  );

  if (rows.length) {
    // Track impression
    pool.query('UPDATE ads SET impressions = impressions + 1 WHERE id = ?', [rows[0].id]).catch(() => {});
    return res.json(rows[0]);
  }
  res.json(null);
}));

// POST /api/ads/:id/click — public: track click
router.post('/ads/:id/click', asyncHandler(async (req, res) => {
  await pool.query('UPDATE ads SET clicks = clicks + 1 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// GET /api/ads — admin: list all ads
router.get('/ads', authRequired, asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM ads ORDER BY created_at DESC');
  res.json(rows);
}));

// POST /api/ads — admin: create
router.post('/ads', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const { name, position, type, content, image_url, link_url } = req.body;
  if (!name || !position || !type)
    return res.status(400).json({ error: 'Name, position and type required' });

  const validPositions = ['header', 'sidebar', 'in-article', 'footer', 'post-top', 'post-bottom'];
  const validTypes = ['adsense', 'custom_html', 'image'];
  if (!validPositions.includes(position))
    return res.status(400).json({ error: 'Invalid position' });
  if (!validTypes.includes(type))
    return res.status(400).json({ error: 'Invalid type' });

  const [result] = await pool.query(
    `INSERT INTO ads (name, position, type, content, image_url, link_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, position, type, content || null, image_url || null, link_url || null]
  );
  res.status(201).json({ id: result.insertId, message: 'Ad created' });
}));

// PUT /api/ads/:id — admin: update
router.put('/ads/:id', authRequired, adminOnly, asyncHandler(async (req, res) => {
  const { name, position, type, content, image_url, link_url, is_active } = req.body;
  await pool.query(
    `UPDATE ads SET
      name = ?, position = ?, type = ?, content = ?,
      image_url = ?, link_url = ?, is_active = ?
     WHERE id = ?`,
    [
      name, position, type, content || null,
      image_url || null, link_url || null,
      is_active ? 1 : 0, req.params.id
    ]
  );
  res.json({ message: 'Ad updated' });
}));

// DELETE /api/ads/:id — admin
router.delete('/ads/:id', authRequired, adminOnly, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM ads WHERE id = ?', [req.params.id]);
  res.json({ message: 'Ad deleted' });
}));

// ============================================================
// 📤 IMAGE UPLOAD
// ============================================================

router.post('/upload', authRequired, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    url: `/uploads/${req.file.filename}`,
    filename: req.file.filename,
    size: req.file.size
  });
});

// ============================================================
// 📊 STATS ROUTES
// ============================================================

// GET /api/stats — admin dashboard
router.get('/stats', authRequired, asyncHandler(async (req, res) => {
  const [[posts]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(status = 'published'), 0) AS published,
       COALESCE(SUM(status = 'draft'), 0) AS drafts,
       COALESCE(SUM(views), 0) AS total_views
     FROM posts`
  );

  const [[comments]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(status = 'pending'), 0) AS pending,
       COALESCE(SUM(status = 'approved'), 0) AS approved,
       COALESCE(SUM(status = 'spam'), 0) AS spam
     FROM comments`
  );

  const [[subs]] = await pool.query('SELECT COUNT(*) AS total FROM subscribers');

  const [[ads]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(impressions), 0) AS impressions,
       COALESCE(SUM(clicks), 0) AS clicks
     FROM ads`
  );

  const [[users]] = await pool.query('SELECT COUNT(*) AS total FROM users');

  res.json({
    posts,
    comments,
    subscribers: subs.total,
    ads,
    users: users.total
  });
}));

// ============================================================
// ❤️ HEALTH CHECK
// ============================================================

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'blog-api',
    time: new Date().toISOString()
  });
});

module.exports = router;
