const db = require("../config/db");
const fs = require("fs");
const path = require("path");


// =====================
// CREATE GALLERY IMAGE
// =====================

exports.createGallery = (req, res) => {

    const {
        title,
        description,
        featured
    } = req.body;

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
            req.file.filename,
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

                console.log(err);

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
// GET FEATURED IMAGES
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
// GET SINGLE IMAGE
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

            const imagePath = path.join(
                __dirname,
                "../uploads/gallery",
                rows[0].image
            );

            if (fs.existsSync(imagePath)) {

                fs.unlinkSync(imagePath);

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

            const imagePath = path.join(
                __dirname,
                "../uploads/gallery",
                rows[0].image
            );

            res.download(imagePath);

        }
    );

};