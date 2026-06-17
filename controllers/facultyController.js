const db = require("../config/db");

// ALL FACULTY
exports.getAll = (req, res) => {
  db.query("SELECT * FROM faculty", (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
};

// PRINCIPAL
exports.getPrincipal = (req, res) => {
  db.query("SELECT * FROM faculty WHERE type='principal' LIMIT 1", (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result[0] || null);
  });
};

// STAFF
exports.getStaff = (req, res) => {
  db.query("SELECT * FROM faculty WHERE type='staff'", (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
};

// NON-STAFF
exports.getNonStaff = (req, res) => {
  db.query("SELECT * FROM faculty WHERE type='Non-staff'", (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
};

// SINGLE
exports.getOne = (req, res) => {
  db.query("SELECT * FROM faculty WHERE id=?", [req.params.id], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result[0] || null);
  });
};