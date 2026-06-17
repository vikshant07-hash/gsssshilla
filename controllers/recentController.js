const db = require("../config/db");

/* GET ALL */
exports.getUpdates = (req, res) => {

  db.query(
    `
    SELECT *
    FROM recent_updates
    ORDER BY created_at DESC
    `,
    (err, result) => {

      if (err) {
        return res.status(500).json(err);
      }

      res.json(result);

    }
  );

};

/* ADD */
exports.addUpdate = (req, res) => {

  const title = req.body.title;

  const file_url =
    req.file ? req.file.path : null;

  db.query(
    `
    INSERT INTO recent_updates
    (title, file_url)
    VALUES (?, ?)
    `,
    [title, file_url],
    (err) => {

      if (err) {
        return res.status(500).json(err);
      }

      res.json({
        success: true,
        message: "Update Added"
      });

    }
  );

};

/* UPDATE */
exports.updateUpdate = (req, res) => {

  const { id } = req.params;

  const title = req.body.title;

  const file_url =
    req.file
      ? req.file.path
      : req.body.file_url;

  db.query(
    `
    UPDATE recent_updates
    SET title=?, file_url=?
    WHERE id=?
    `,
    [title, file_url, id],
    (err) => {

      if (err) {
        return res.status(500).json(err);
      }

      res.json({
        success: true,
        message: "Updated"
      });

    }
  );

};

/* DELETE */
exports.deleteUpdate = (req, res) => {

  const { id } = req.params;

  db.query(
    `
    DELETE FROM recent_updates
    WHERE id=?
    `,
    [id],
    (err) => {

      if (err) {
        return res.status(500).json(err);
      }

      res.json({
        success: true,
        message: "Deleted"
      });

    }
  );

};