const express = require("express");
const router = express.Router();
const db = require("../config/db");


// ================= GET CONTACT INFO =================
router.get("/info", (req, res) => {
  db.query("SELECT * FROM contact_info WHERE id=1", (err, result) => {
    if (err) return res.json(err);
    res.json(result[0]);
  });
});


// ================= UPDATE CONTACT INFO =================
router.post("/update", (req, res) => {
  const { school_name, address, phone, email } = req.body;

  const sql = `
    UPDATE contact_info 
    SET school_name=?, address=?, phone=?, email=? 
    WHERE id=1
  `;

  db.query(sql, [school_name, address, phone, email], (err) => {
    if (err) return res.json({ message: "Error updating" });

    res.json({ message: "Updated Successfully ✅" });
  });
});


// ================= GET MESSAGES =================
router.get("/messages", (req, res) => {
  db.query("SELECT * FROM contacts ORDER BY id DESC", (err, result) => {
    if (err) return res.json(err);
    res.json(result);
  });
});


// ================= DELETE MESSAGE =================
router.delete("/delete/:id", (req, res) => {
  const id = req.params.id;

  db.query("DELETE FROM contacts WHERE id=?", [id], (err) => {
    if (err) return res.json({ message: "Delete error" });

    res.json({ message: "Deleted ✅" });
  });
});

module.exports = router;