const express = require("express");
const router = express.Router();
const db = require("../config/db");

router.post("/", (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.json({ message: "All fields required" });
  }

  const sql = "INSERT INTO contacts (name,email,message) VALUES (?,?,?)";

  db.query(sql, [name, email, message], (err) => {
    if (err) {
      console.log(err);
      return res.json({ message: "Error saving message" });
    }

    res.json({ message: "Message sent successfully ✅" });
  });
});

module.exports = router;