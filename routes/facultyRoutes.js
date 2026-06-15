const router = require("express").Router();
const c = require("../controllers/facultyController");

router.get("/", c.getAll);
router.get("/principal", c.getPrincipal);
router.get("/staff", c.getStaff);
router.get("/non-staff", c.getNonStaff);
router.get("/:id", c.getOne);

module.exports = router;