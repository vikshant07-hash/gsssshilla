const db = require("../config/db");
const cloudinary = require("../config/cloudinary");

// =====================
// CREATE GALLERY IMAGE
// =====================

exports.createGallery = (req, res) => {

  const { title, description, featured } = req.body;

  if (!title) {
    return res.status(400).json({
      success: false,
      message: "Title is required"
    });
  }

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Image is required"
    });
  }

  db.query(
    `
    INSERT INTO gallery
    (
      title,
      description,
      image,
      featured
    )
    VALUES (?,?,?,?)
    `,
    [
      title,
      description || "",
      req.file.path,
      featured || 0
    ],
    (err, result) => {

      if (err) {
        console.log(err);

        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      res.json({
        success: true,
        message: "Image uploaded successfully",
        id: result.insertId
      });
    }
  );
};

// =====================
// GET ALL IMAGES
// =====================

exports.getGallery = (req, res) => {

  db.query(
    `
    SELECT *
    FROM gallery
    ORDER BY id DESC
    `,
    (err, rows) => {

      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      res.json(rows);
    }
  );
};

// =====================
// GET FEATURED
// =====================

exports.getFeatured = (req, res) => {

  db.query(
    `
    SELECT *
    FROM gallery
    WHERE featured = 1
    ORDER BY id DESC
    LIMIT 5
    `,
    (err, rows) => {

      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      res.json(rows);
    }
  );
};

// =====================
// GET SINGLE
// =====================

exports.getSingle = (req, res) => {

  db.query(
    `
    SELECT *
    FROM gallery
    WHERE id = ?
    `,
    [req.params.id],
    (err, rows) => {

      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: "Image not found"
        });
      }

      res.json(rows[0]);
    }
  );
};

// =====================
// DELETE IMAGE
// =====================

exports.deleteGallery = (req, res) => {

  db.query(
    `
    SELECT image
    FROM gallery
    WHERE id = ?
    `,
    [req.params.id],
    async (err, rows) => {

      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: "Image not found"
        });
      }

      try {

        const imageUrl = rows[0].image;

        const publicId = imageUrl
          .split("/")
          .slice(-2)
          .join("/")
          .split(".")[0];

        await cloudinary.uploader.destroy(publicId);

      } catch (e) {
        console.log("Cloudinary delete error:", e);
      }

      db.query(
        `
        DELETE FROM gallery
        WHERE id = ?
        `,
        [req.params.id],
        (err) => {

          if (err) {
            return res.status(500).json({
              success: false,
              error: err.message
            });
          }

          res.json({
            success: true,
            message: "Image deleted successfully"
          });
        }
      );
    }
  );
};

// =====================
// DOWNLOAD IMAGE
// =====================

exports.downloadImage = (req, res) => {

  db.query(
    `
    SELECT *
    FROM gallery
    WHERE id = ?
    `,
    [req.params.id],
    (err, rows) => {

      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: "Image not found"
        });
      }

      res.json({
        success: true,
        image: rows[0].image
      });
    }
  );
};