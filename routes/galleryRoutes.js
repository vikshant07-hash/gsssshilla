const express = require("express");
const router = express.Router();

const upload =
require("../middleware/uploadGallery");

const gallery =
require("../controllers/galleryController");

router.post(
  "/",
  upload.single("image"),
  gallery.createGallery
);

router.get("/", gallery.getGallery);

router.get(
  "/featured",
  gallery.getFeatured
);

router.get(
  "/single/:id",
  gallery.getSingle
);

router.get(
  "/download/:id",
  gallery.downloadImage
);

router.delete(
  "/:id",
  gallery.deleteGallery
);

module.exports = router;