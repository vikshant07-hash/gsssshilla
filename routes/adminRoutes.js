const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();

const { cloudinary, uploadSlider, uploadRecent, uploadGallery, uploadFaculty, uploadDownload } = require('../config/cloudinary');
const { db } = require('../config/db');

console.log('🔧 adminRoutes.js loaded - Protected Routes');

// ============================================================
// JWT SECRET
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_12345';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'my_refresh_secret_67890';

// ============================================================
// MIDDLEWARE - Token Verification
// ============================================================
const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided',
        code: 'NO_TOKEN'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid token',
      code: 'INVALID_TOKEN'
    });
  }
};

// ============================================================
// MIDDLEWARE - CSRF Verification
// ============================================================
const verifyCsrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const csrfToken = req.headers['x-csrf-token'];
  const sessionToken = req.session?.csrfToken;

  if (!csrfToken || !sessionToken || csrfToken !== sessionToken) {
    return res.status(403).json({
      success: false,
      message: 'Invalid CSRF token',
      code: 'CSRF_INVALID'
    });
  }

  next();
};

// ============================================================
// ============================================================
// SLIDER IMAGE ROUTES (Protected)
// ============================================================
// ============================================================

// GET - All Slider Images
router.get('/slider/all', verifyToken, (req, res) => {
  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist
     FROM slider_images 
     ORDER BY \`order\` ASC, created_at DESC`,
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true, data: results || [] });
    }
  );
});

// POST - Upload Slider Images
router.post('/slider/add', verifyToken, verifyCsrf, uploadSlider.array('images', 20), async (req, res) => {
  console.log("📸 Slider upload request received");
  
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No images uploaded" });
    }

    const uploaded = [];
    const errors = [];

    const orderResult = await new Promise((resolve, reject) => {
      db.query("SELECT MAX(`order`) as maxOrder FROM slider_images", (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    let nextOrder = (orderResult[0]?.maxOrder || 0) + 1;

    for (const file of req.files) {
      try {
        const cloudinaryUrl = file.path;
        const publicId = file.filename;
        const { title, alt_text } = req.body;

        await new Promise((resolve, reject) => {
          db.query(
            `INSERT INTO slider_images 
            (filename, file_path, public_id, file_size, mime_type, title, alt_text, \`order\`, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [publicId, cloudinaryUrl, publicId, file.size || 0, file.mimetype || 'image/jpeg', title || file.originalname, alt_text || '', nextOrder++],
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });

        uploaded.push({ filename: publicId, url: cloudinaryUrl });
      } catch (err) {
        errors.push({ file: file.originalname || file.filename, error: err.message });
        try { await cloudinary.uploader.destroy(file.filename); } catch (e) {}
      }
    }

    // Log activity
    console.log(`📸 ${uploaded.length} slider images uploaded by admin`);

    res.json({
      success: true,
      message: `${uploaded.length} images uploaded successfully`,
      uploaded: uploaded,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("❌ Upload Error:", error);
    res.status(500).json({ success: false, message: error.message || "Upload failed" });
  }
});

// DELETE - Slider Image
router.delete('/slider/delete/:id', verifyToken, verifyCsrf, (req, res) => {
  const { id } = req.params;
  
  db.query("SELECT * FROM slider_images WHERE id = ?", [id], (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!results || results.length === 0) {
      return res.status(404).json({ success: false, message: "Image not found" });
    }

    const image = results[0];
    const publicId = image.public_id || image.filename;
    
    // Delete from Cloudinary
    cloudinary.uploader.destroy(publicId).catch(err => console.warn("Cloudinary warning:", err.message));

    db.query("DELETE FROM slider_images WHERE id = ?", [id], (deleteErr) => {
      if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
      
      // Reorder remaining images
      db.query("SET @new_order = 0; UPDATE slider_images SET `order` = (@new_order := @new_order + 1) ORDER BY `order` ASC;", (reorderErr) => {
        if (reorderErr) console.warn("Reorder warning:", reorderErr.message);
        res.json({ success: true, message: "Image deleted successfully" });
      });
    });
  });
});

// PUT - Update Slider Image
router.put('/slider/update/:id', verifyToken, verifyCsrf, (req, res) => {
  const { id } = req.params;
  const { title, alt_text, is_active } = req.body;
  
  db.query(
    `UPDATE slider_images SET title = ?, alt_text = ?, is_active = ?, updated_at = NOW() WHERE id = ?`,
    [title || '', alt_text || '', is_active !== undefined ? is_active : 1, id],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Image not found" });
      }
      res.json({ success: true, message: "Image updated successfully" });
    }
  );
});

// PUT - Reorder Slider Images
router.put('/slider/reorder', verifyToken, verifyCsrf, (req, res) => {
  const { orders } = req.body;
  if (!orders || !Array.isArray(orders)) {
    return res.status(400).json({ success: false, message: "Orders array is required" });
  }

  const queries = orders.map(({ id, order }) => {
    return new Promise((resolve, reject) => {
      db.query("UPDATE slider_images SET `order` = ? WHERE id = ?", [order, id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  Promise.all(queries)
    .then(() => res.json({ success: true, message: "Order updated successfully" }))
    .catch(error => res.status(500).json({ success: false, error: error.message }));
});

// ============================================================
// ============================================================
// RECENT UPDATES ROUTES (Protected)
// ============================================================
// ============================================================

// GET - All Recent Updates
router.get('/recent/all', verifyToken, (req, res) => {
  db.query(
    `SELECT *, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist 
     FROM recent_updates ORDER BY created_at DESC`,
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results || [] });
    }
  );
});

// POST - Add Recent Update
router.post('/recent/add', verifyToken, verifyCsrf, uploadRecent.single("file"), (req, res) => {
  const { title, description, category, link, isNew } = req.body;
  
  if (!title) {
    return res.status(400).json({ success: false, message: "Title is required" });
  }

  const file_url = req.file ? req.file.path : null;
  const file_public_id = req.file ? req.file.filename : null;
  const file_type = req.file ? req.file.mimetype : null;
  const file_size = req.file ? req.file.size : null;

  db.query(
    `INSERT INTO recent_updates (title, description, file_url, public_id, file_type, file_size, category, link, is_new, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [title, description || "", file_url, file_public_id, file_type, file_size, category || "general", link || null, isNew !== undefined ? parseInt(isNew) : 1],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      
      // Log activity
      console.log(`📝 Recent update added: ${title}`);
      
      res.status(201).json({ 
        success: true, 
        message: "✅ Update added successfully!", 
        data: { id: result.insertId } 
      });
    }
  );
});

// PUT - Update Recent Update
router.put('/recent/update/:id', verifyToken, verifyCsrf, uploadRecent.single("file"), (req, res) => {
  const { id } = req.params;
  const { title, description, category, link, isNew } = req.body;
  
  if (!title) {
    return res.status(400).json({ success: false, message: "Title is required" });
  }

  db.query("SELECT * FROM recent_updates WHERE id = ?", [id], (fetchErr, fetchResult) => {
    if (fetchErr || !fetchResult || fetchResult.length === 0) {
      return res.status(404).json({ success: false, message: "Update not found" });
    }

    const existing = fetchResult[0];
    let file_url = existing.file_url;
    let file_public_id = existing.public_id;
    let file_type = existing.file_type;
    let file_size = existing.file_size;

    if (req.file) {
      if (existing.public_id) {
        cloudinary.uploader.destroy(existing.public_id).catch(err => console.error("Cloudinary error:", err));
      }
      file_url = req.file.path;
      file_public_id = req.file.filename;
      file_type = req.file.mimetype;
      file_size = req.file.size;
    }

    db.query(
      `UPDATE recent_updates SET title=?, description=?, file_url=?, public_id=?, file_type=?, file_size=?, category=?, link=?, is_new=?, updated_at=NOW() WHERE id=?`,
      [title, description || existing.description, file_url, file_public_id, file_type, file_size, category || existing.category, link || existing.link || null, isNew !== undefined ? parseInt(isNew) : existing.is_new, id],
      (updateErr) => {
        if (updateErr) return res.status(500).json({ success: false, error: updateErr.message });
        
        console.log(`📝 Recent update updated: ${title}`);
        res.json({ success: true, message: "✅ Update updated successfully!" });
      }
    );
  });
});

// DELETE - Recent Update
router.delete('/recent/delete/:id', verifyToken, verifyCsrf, (req, res) => {
  const { id } = req.params;
  
  db.query("SELECT * FROM recent_updates WHERE id = ?", [id], (fetchErr, fetchResult) => {
    if (fetchErr || !fetchResult || fetchResult.length === 0) {
      return res.status(404).json({ success: false, message: "Update not found" });
    }

    const update = fetchResult[0];
    if (update.public_id) {
      cloudinary.uploader.destroy(update.public_id).catch(err => console.error("Cloudinary error:", err));
    }

    db.query("DELETE FROM recent_updates WHERE id = ?", [id], (deleteErr) => {
      if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
      
      console.log(`📝 Recent update deleted: ${update.title}`);
      res.json({ success: true, message: "✅ Update deleted successfully!" });
    });
  });
});

// DELETE - Bulk Delete Recent Updates
router.delete('/recent/bulk-delete', verifyToken, verifyCsrf, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No IDs provided" });
  }

  const placeholders = ids.map(() => '?').join(',');
  
  db.query(`SELECT * FROM recent_updates WHERE id IN (${placeholders})`, ids, (fetchErr, fetchResults) => {
    if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });
    
    fetchResults.forEach(update => {
      if (update.public_id) {
        cloudinary.uploader.destroy(update.public_id).catch(err => console.error("Cloudinary error:", err));
      }
    });

    db.query(`DELETE FROM recent_updates WHERE id IN (${placeholders})`, ids, (deleteErr) => {
      if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
      
      console.log(`📝 ${ids.length} recent updates deleted`);
      res.json({ success: true, message: `${ids.length} updates deleted successfully ✅` });
    });
  });
});

// ============================================================
// ============================================================
// GALLERY ROUTES (Protected)
// ============================================================
// ============================================================

// GET - All Gallery Slider (Admin)
router.get('/gallery/slider/all', verifyToken, (req, res) => {
  db.query(
    `SELECT * FROM gallery_slider ORDER BY \`order\` ASC, created_at DESC`,
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results || [] });
    }
  );
});

// POST - Add Gallery Slider
router.post('/gallery/slider/add', verifyToken, verifyCsrf, uploadSlider.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "Image is required" });
  }

  const { title, description, link } = req.body;
  const file_path = req.file.path;
  const public_id = req.file.filename;
  const filename = req.file.filename;

  db.query("SELECT MAX(`order`) as maxOrder FROM gallery_slider", (err, result) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    const nextOrder = (result[0]?.maxOrder || 0) + 1;

    db.query(
      `INSERT INTO gallery_slider (filename, file_path, public_id, title, description, link, \`order\`, is_active, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [filename, file_path, public_id, title || '', description || '', link || '', nextOrder],
      (insertErr, insertResult) => {
        if (insertErr) return res.status(500).json({ success: false, error: insertErr.message });
        
        console.log(`📸 Gallery slider added: ${title || filename}`);
        res.json({ success: true, message: "✅ Slider image added!", data: { id: insertResult.insertId } });
      }
    );
  });
});

// DELETE - Gallery Slider
router.delete('/gallery/slider/delete/:id', verifyToken, verifyCsrf, (req, res) => {
  const { id } = req.params;
  
  db.query("SELECT * FROM gallery_slider WHERE id = ?", [id], (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!results || results.length === 0) {
      return res.status(404).json({ success: false, message: "Image not found" });
    }

    const image = results[0];
    if (image.public_id) {
      cloudinary.uploader.destroy(image.public_id).catch(err => console.error("Cloudinary error:", err));
    }

    db.query("DELETE FROM gallery_slider WHERE id = ?", [id], (deleteErr) => {
      if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
      
      console.log(`📸 Gallery slider deleted: ${image.title || image.filename}`);
      res.json({ success: true, message: "✅ Slider deleted!" });
    });
  });
});

// ============================================================
// GALLERY IMAGES (Protected)
// ============================================================

// GET - All Gallery Images (Admin)
router.get('/gallery/images/all', verifyToken, (req, res) => {
  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist 
     FROM gallery_images 
     ORDER BY created_at DESC`,
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results || [] });
    }
  );
});

// GET - Recent Gallery Images (Admin)
router.get('/gallery/images/recent', verifyToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist 
     FROM gallery_images 
     ORDER BY created_at DESC LIMIT ?`,
    [limit],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results || [] });
    }
  );
});

// POST - Add Gallery Images
router.post('/gallery/images/add', verifyToken, verifyCsrf, uploadGallery.array('media', 30), async (req, res) => {
  const { title, description, image_date } = req.body;

  console.log("📸 Add Gallery Media Request");
  console.log("📸 Title:", title);
  console.log("📸 Date:", image_date);
  console.log("📸 Files:", req.files ? req.files.length : 0);

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: "No media uploaded" });
  }

  const uploaded = [];
  const errors = [];
  const uploadDate = image_date || new Date().toISOString().split('T')[0];

  for (const file of req.files) {
    try {
      const isVideo = file.mimetype?.startsWith('video/') || false;
      const filePath = file.path;
      const publicId = file.filename;
      
      let videoThumbnail = null;
      if (isVideo) {
        videoThumbnail = filePath.replace(/\.[^.]+$/, '.jpg');
      }

      await new Promise((resolve, reject) => {
        db.query(
          `INSERT INTO gallery_images 
           (filename, file_path, public_id, file_size, mime_type, media_type, 
            video_thumbnail, title, description, image_date, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            publicId, 
            filePath, 
            publicId, 
            file.size || 0, 
            file.mimetype || (isVideo ? 'video/mp4' : 'image/jpeg'),
            isVideo ? 'video' : 'image',
            videoThumbnail,
            title || '', 
            description || '', 
            uploadDate
          ],
          (err, result) => {
            if (err) reject(err);
            else resolve(result);
          }
        );
      });
      uploaded.push({ filename: publicId, type: isVideo ? 'video' : 'image' });
    } catch (err) {
      console.error("❌ Upload error:", err);
      errors.push({ file: file.originalname, error: err.message });
    }
  }

  console.log(`📸 ${uploaded.length} gallery media uploaded`);

  res.json({
    success: true,
    message: `${uploaded.length} media items uploaded successfully!`,
    uploaded: uploaded,
    errors: errors.length > 0 ? errors : undefined
  });
});

// DELETE - Gallery Image
router.delete('/gallery/images/delete/:id', verifyToken, verifyCsrf, (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, message: "Invalid ID" });
  }

  db.query("SELECT * FROM gallery_images WHERE id = ?", [id], (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!results || results.length === 0) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    const item = results[0];
    if (item.public_id) {
      cloudinary.uploader.destroy(item.public_id, { 
        resource_type: item.media_type === 'video' ? 'video' : 'image' 
      }).catch(err => console.error("Cloudinary error:", err));
    }

    db.query("DELETE FROM gallery_images WHERE id = ?", [id], (deleteErr) => {
      if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
      
      console.log(`📸 Gallery media deleted: ${item.title || item.filename}`);
      res.json({ success: true, message: "✅ Gallery item deleted!" });
    });
  });
});

// ============================================================
// ============================================================
// FACULTY ROUTES (Protected)
// ============================================================
// ============================================================

// GET - All Faculty (Admin)
router.get('/faculty/all', verifyToken, (req, res) => {
  db.query(
    "SELECT * FROM faculty ORDER BY is_principal DESC, staff_type ASC, `order` ASC, name ASC",
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results || [] });
    }
  );
});

// GET - Single Faculty
router.get('/faculty/:id', verifyToken, (req, res) => {
  db.query("SELECT * FROM faculty WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!results || results.length === 0) {
      return res.status(404).json({ success: false, message: "Faculty not found" });
    }
    res.json({ success: true, data: results[0] });
  });
});

// POST - Add Faculty
router.post('/faculty/add', verifyToken, verifyCsrf, uploadFaculty.single("photo"), (req, res) => {
  const { name, designation, department, subject, qualification, experience, email, phone, message, is_principal, staff_type, joining_date } = req.body;

  if (!name || !designation) {
    return res.status(400).json({ success: false, message: "Name and Designation are required" });
  }

  const photo_url = req.file ? req.file.path : null;
  const photo_public_id = req.file ? req.file.filename : null;

  db.query(
    `INSERT INTO faculty (name, designation, department, subject, qualification, experience, email, phone, message, photo_url, photo_public_id, is_principal, staff_type, joining_date, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [name, designation, department || null, subject || null, qualification || null, experience || null, email || null, phone || null, message || null, photo_url, photo_public_id, is_principal || 0, staff_type || 'teaching', joining_date || null],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      
      console.log(`👨‍🏫 Faculty added: ${name} (${designation})`);
      res.status(201).json({ success: true, message: "✅ Faculty added!", data: { id: result.insertId } });
    }
  );
});

// PUT - Update Faculty
router.put('/faculty/update/:id', verifyToken, verifyCsrf, uploadFaculty.single("photo"), (req, res) => {
  const { id } = req.params;
  const { name, designation, department, subject, qualification, experience, email, phone, message, is_principal, staff_type, is_active, joining_date } = req.body;

  if (!name || !designation) {
    return res.status(400).json({ success: false, message: "Name and Designation are required" });
  }

  db.query("SELECT * FROM faculty WHERE id = ?", [id], (err, results) => {
    if (err || !results || results.length === 0) {
      return res.status(404).json({ success: false, message: "Faculty not found" });
    }

    const existing = results[0];
    let photo_url = existing.photo_url;
    let photo_public_id = existing.photo_public_id;

    if (req.file) {
      if (existing.photo_public_id) {
        cloudinary.uploader.destroy(existing.photo_public_id).catch(e => console.error(e));
      }
      photo_url = req.file.path;
      photo_public_id = req.file.filename;
    }

    db.query(
      `UPDATE faculty SET name=?, designation=?, department=?, subject=?, qualification=?, experience=?, email=?, phone=?, message=?, photo_url=?, photo_public_id=?, is_principal=?, staff_type=?, is_active=?, joining_date=?, updated_at=NOW() WHERE id=?`,
      [name, designation, department || null, subject || null, qualification || null, experience || null, email || null, phone || null, message || null, photo_url, photo_public_id, is_principal || 0, staff_type || 'teaching', is_active !== undefined ? parseInt(is_active) : 1, joining_date || null, id],
      (updateErr) => {
        if (updateErr) return res.status(500).json({ success: false, error: updateErr.message });
        
        console.log(`👨‍🏫 Faculty updated: ${name} (${designation})`);
        res.json({ success: true, message: "✅ Faculty updated!" });
      }
    );
  });
});

// DELETE - Faculty
router.delete('/faculty/delete/:id', verifyToken, verifyCsrf, (req, res) => {
  const { id } = req.params;
  
  db.query("SELECT * FROM faculty WHERE id = ?", [id], (err, results) => {
    if (err || !results || results.length === 0) {
      return res.status(404).json({ success: false, message: "Faculty not found" });
    }

    const item = results[0];
    if (item.photo_public_id) {
      cloudinary.uploader.destroy(item.photo_public_id).catch(e => console.error(e));
    }

    db.query("DELETE FROM faculty WHERE id = ?", [id], (deleteErr) => {
      if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
      
      console.log(`👨‍🏫 Faculty deleted: ${item.name}`);
      res.json({ success: true, message: "✅ Faculty deleted!" });
    });
  });
});

// ============================================================
// ============================================================
// DOWNLOAD ROUTES (Protected)
// ============================================================
// ============================================================

// GET - All Downloads (Admin)
router.get('/downloads/all', verifyToken, (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  
  db.query("SELECT COUNT(*) as total FROM downloads", (countErr, countResult) => {
    if (countErr) return res.status(500).json({ success: false, error: countErr.message });
    
    const total = countResult[0]?.total || 0;
    
    db.query(
      "SELECT * FROM downloads ORDER BY created_at DESC LIMIT ? OFFSET ?", 
      [parseInt(limit), offset], 
      (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({
          success: true,
          data: results || [],
          pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
      }
    );
  });
});

// POST - Add Download
router.post('/downloads/add', verifyToken, verifyCsrf, uploadDownload.single("file"), (req, res) => {
  const { title, description, class: classNum, session_year, category, series, subject } = req.body;

  console.log("📥 Add Download Request:", req.body);

  if (!title || !classNum || !session_year || !category) {
    return res.status(400).json({ success: false, message: "Title, Class, Session and Category are required" });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: "File is required" });
  }

  db.query(
    `INSERT INTO downloads (title, description, class, session_year, category, series, subject, 
     filename, file_path, public_id, file_size, file_type, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      title,
      description || '',
      classNum,
      session_year,
      category,
      series || null,
      subject || null,
      req.file.filename,
      req.file.path,
      req.file.filename,
      req.file.size || 0,
      req.file.mimetype || 'application/pdf'
    ],
    (err, result) => {
      if (err) {
        console.error("❌ Insert Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }

      console.log(`📥 Download added: ${title} (Class ${classNum})`);
      res.status(201).json({
        success: true,
        message: "✅ File uploaded successfully!",
        data: { id: result.insertId }
      });
    }
  );
});

// PUT - Update Download
router.put('/downloads/update/:id', verifyToken, verifyCsrf, uploadDownload.single("file"), (req, res) => {
  const { id } = req.params;
  const { title, description, class: classNum, session_year, category, series, subject, is_active } = req.body;

  if (!title || !classNum || !session_year || !category) {
    return res.status(400).json({ success: false, message: "Title, Class, Session and Category are required" });
  }

  db.query("SELECT * FROM downloads WHERE id = ?", [id], (fetchErr, fetchResult) => {
    if (fetchErr || !fetchResult || fetchResult.length === 0) {
      return res.status(404).json({ success: false, message: "Download not found" });
    }

    const existing = fetchResult[0];
    let file_path = existing.file_path;
    let public_id = existing.public_id;
    let filename = existing.filename;
    let file_size = existing.file_size;
    let file_type = existing.file_type;

    if (req.file) {
      if (existing.public_id) {
        cloudinary.uploader.destroy(existing.public_id).catch(err => console.error("Cloudinary delete error:", err));
      }
      file_path = req.file.path;
      public_id = req.file.filename;
      filename = req.file.filename;
      file_size = req.file.size || 0;
      file_type = req.file.mimetype || 'application/pdf';
    }

    db.query(
      `UPDATE downloads SET title=?, description=?, class=?, session_year=?, category=?, 
       series=?, subject=?, filename=?, file_path=?, public_id=?, file_size=?, file_type=?, 
       is_active=?, updated_at=NOW() WHERE id=?`,
      [
        title, description || '', classNum, session_year, category,
        series || null, subject || null, filename, file_path, public_id,
        file_size, file_type, is_active !== undefined ? parseInt(is_active) : 1, id
      ],
      (updateErr) => {
        if (updateErr) return res.status(500).json({ success: false, error: updateErr.message });
        
        console.log(`📥 Download updated: ${title}`);
        res.json({ success: true, message: "✅ Download updated successfully!" });
      }
    );
  });
});

// DELETE - Download
router.delete('/downloads/delete/:id', verifyToken, verifyCsrf, (req, res) => {
  const { id } = req.params;

  db.query("SELECT * FROM downloads WHERE id = ?", [id], (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!results || results.length === 0) {
      return res.status(404).json({ success: false, message: "Download not found" });
    }

    const item = results[0];
    if (item.public_id) {
      cloudinary.uploader.destroy(item.public_id).catch(err => console.error("Cloudinary error:", err));
    }

    db.query("DELETE FROM downloads WHERE id = ?", [id], (deleteErr) => {
      if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
      
      console.log(`📥 Download deleted: ${item.title}`);
      res.json({ success: true, message: "✅ Deleted successfully!" });
    });
  });
});

// DELETE - Bulk Delete Downloads
router.delete('/downloads/bulk-delete', verifyToken, verifyCsrf, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No IDs provided" });
  }

  const placeholders = ids.map(() => '?').join(',');
  
  db.query(`SELECT * FROM downloads WHERE id IN (${placeholders})`, ids, (fetchErr, fetchResults) => {
    if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });
    
    fetchResults.forEach(item => {
      if (item.public_id) {
        cloudinary.uploader.destroy(item.public_id).catch(err => console.error(err));
      }
    });

    db.query(`DELETE FROM downloads WHERE id IN (${placeholders})`, ids, (deleteErr) => {
      if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
      
      console.log(`📥 ${ids.length} downloads deleted`);
      res.json({ success: true, message: `${ids.length} items deleted ✅` });
    });
  });
});

// ============================================================
// ============================================================
// CONTACT ROUTES (Protected)
// ============================================================
// ============================================================

// GET - All Contact Messages
router.get('/contact/messages', verifyToken, (req, res) => {
  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist
     FROM contact_messages 
     ORDER BY created_at DESC`,
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results || [] });
    }
  );
});

// GET - Contact Message Detail
router.get('/contact/messages/:id', verifyToken, (req, res) => {
  const { id } = req.params;

  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist
     FROM contact_messages WHERE id = ?`,
    [id],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (!results || results.length === 0) {
        return res.status(404).json({ success: false, message: "Message not found" });
      }

      // Mark as read
      db.query("UPDATE contact_messages SET is_read = 1 WHERE id = ?", [id]);

      res.json({ success: true, data: results[0] });
    }
  );
});

// DELETE - Contact Message
router.delete('/contact/messages/delete/:id', verifyToken, verifyCsrf, (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, message: "Invalid ID" });
  }

  db.query("DELETE FROM contact_messages WHERE id = ?", [id], (err, result) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Message not found" });
    }
    
    console.log(`📩 Contact message deleted: ID ${id}`);
    res.json({ success: true, message: "✅ Message deleted successfully!" });
  });
});

// PUT - Update Contact Info
router.put('/contact/info/update', verifyToken, verifyCsrf, (req, res) => {
  const { school_name, address, phone, email } = req.body;

  if (!school_name || !address || !phone || !email) {
    return res.status(400).json({ 
      success: false, 
      message: "All fields are required (school_name, address, phone, email)" 
    });
  }

  db.query("SELECT id FROM contact_info WHERE id = 1", (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });

    if (results && results.length > 0) {
      db.query(
        `UPDATE contact_info 
         SET school_name = ?, address = ?, phone = ?, email = ?, updated_at = NOW()
         WHERE id = 1`,
        [school_name, address, phone, email],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ success: false, error: updateErr.message });
          
          console.log(`📝 Contact info updated`);
          res.json({ success: true, message: "✅ Contact information updated successfully!" });
        }
      );
    } else {
      db.query(
        `INSERT INTO contact_info (id, school_name, address, phone, email, created_at) 
         VALUES (1, ?, ?, ?, ?, NOW())`,
        [school_name, address, phone, email],
        (insertErr) => {
          if (insertErr) return res.status(500).json({ success: false, error: insertErr.message });
          
          console.log(`📝 Contact info created`);
          res.json({ success: true, message: "✅ Contact information saved successfully!" });
        }
      );
    }
  });
});

// ============================================================
// ============================================================
// STATS ROUTES (Protected)
// ============================================================
// ============================================================

// GET - Dashboard Stats
router.get('/stats/dashboard', verifyToken, (req, res) => {
  const queries = {
    faculty: "SELECT COUNT(*) as count FROM faculty WHERE is_active = 1",
    downloads: "SELECT COUNT(*) as count FROM downloads WHERE is_active = 1",
    slider: "SELECT COUNT(*) as count FROM slider_images WHERE is_active = 1",
    gallery: "SELECT COUNT(*) as count FROM gallery_images WHERE is_active = 1",
    recent: "SELECT COUNT(*) as count FROM recent_updates",
    messages: "SELECT COUNT(*) as count FROM contact_messages WHERE is_read = 0",
    total_downloads: "SELECT SUM(download_count) as count FROM downloads"
  };

  const results = {};
  let completed = 0;
  const totalQueries = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    db.query(query, (err, result) => {
      if (err) {
        results[key] = { count: 0 };
      } else {
        results[key] = result[0] || { count: 0 };
      }
      completed++;
      if (completed === totalQueries) {
        res.json({
          success: true,
          data: {
            faculty: results.faculty?.count || 0,
            downloads: results.downloads?.count || 0,
            slider: results.slider?.count || 0,
            gallery: results.gallery?.count || 0,
            recent: results.recent?.count || 0,
            unreadMessages: results.messages?.count || 0,
            totalDownloads: results.total_downloads?.count || 0
          }
        });
      }
    });
  });
});

// ============================================================
// ============================================================
// EXPORT
// ============================================================
// ============================================================

console.log('✅ All protected routes defined');
module.exports = router;
