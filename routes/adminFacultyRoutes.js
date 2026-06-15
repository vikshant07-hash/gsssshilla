const router = require("express").Router();
const c = require("../controllers/adminFacultyController");
const verifyToken = require("../middleware/authMiddleware");
const multer = require("multer");

const storage = multer.diskStorage({
  destination:"uploads/",
  filename:(req,file,cb)=>{
    cb(null,Date.now()+"-"+file.originalname);
  }
});

const upload = multer({storage});

router.post(
  "/add",
  verifyToken,
  upload.single("photo"),
  c.add
);

router.put(
  "/update/:id",
  verifyToken,
  c.update
);

router.delete(
  "/delete/:id",
  verifyToken,
  c.remove
);

module.exports = router;