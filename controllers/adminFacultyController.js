const db = require("../config/db");
const cloudinary = require("../config/cloudinary");

function getPublicId(imageUrl) {
  return imageUrl.split("/").slice(-2).join("/").split(".")[0];
}

exports.add = (req, res) => {
  const photo = req.file ? req.file.path : "";
  const sql = `INSERT INTO faculty (name,type,subject,qualification,experience,previous_school,message,photo) VALUES (?,?,?,?,?,?,?,?)`;
  db.query(sql, [req.body.name, req.body.type, req.body.subject, req.body.qualification, req.body.experience, req.body.previous_school, req.body.message, photo], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ msg: "added" });
  });
};

exports.update = (req, res) => {
  const id = req.params.id;
  const newPhoto = req.file ? req.file.path : null;

  if (!newPhoto) {
    return db.query(`UPDATE faculty SET name=?,type=?,subject=?,qualification=?,experience=?,previous_school=?,message=? WHERE id=?`,
      [req.body.name, req.body.type, req.body.subject, req.body.qualification, req.body.experience, req.body.previous_school, req.body.message, id],
      (err) => { if (err) return res.status(500).json(err); res.json({ msg: "updated" }); });
  }

  db.query("SELECT photo FROM faculty WHERE id=?", [id], async (err, rows) => {
    if (err) return res.status(500).json(err);
    if (rows.length && rows[0].photo) {
      try { await cloudinary.uploader.destroy(getPublicId(rows[0].photo)); }
      catch (e) { console.log("Cloudinary delete error:", e); }
    }
    db.query(`UPDATE faculty SET name=?,type=?,subject=?,qualification=?,experience=?,previous_school=?,message=?,photo=? WHERE id=?`,
      [req.body.name, req.body.type, req.body.subject, req.body.qualification, req.body.experience, req.body.previous_school, req.body.message, newPhoto, id],
      (err2) => { if (err2) return res.status(500).json(err2); res.json({ msg: "updated" }); });
  });
};

exports.remove = (req, res) => {
  const id = req.params.id;
  db.query("SELECT photo FROM faculty WHERE id=?", [id], async (err, rows) => {
    if (err) return res.status(500).json(err);
    if (rows.length && rows[0].photo) {
      try { await cloudinary.uploader.destroy(getPublicId(rows[0].photo)); }
      catch (e) { console.log("Cloudinary delete error:", e); }
    }
    db.query("DELETE FROM faculty WHERE id=?", [id], (err2) => {
      if (err2) return res.status(500).json(err2);
      res.json({ msg: "deleted" });
    });
  });
};