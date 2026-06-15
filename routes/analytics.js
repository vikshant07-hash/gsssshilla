const express = require("express");
const router = express.Router();
const db = require("../config/db");

/* =========================
   TRACK VISITOR (EVERY HIT COUNT)
========================= */

router.get("/track", (req, res) => {

  let ip =
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    req.ip;

  const today = new Date().toISOString().slice(0, 10);

  const sql = `
    INSERT INTO visitor_logs (ip_address, visit_date)
    VALUES (?, ?)
  `;

  db.query(sql, [ip, today], (err) => {

    if (err) {
      console.log("TRACK ERROR:", err);
      return res.json({
        success: false,
        message: "Track failed"
      });
    }

    res.json({
      success: true,
      message: "Visit counted"
    });

  });

});


/* =========================
   GET STATS (TOTAL + TODAY)
========================= */

router.get("/stats", (req, res) => {

  const today = new Date().toISOString().slice(0, 10);

  /* TODAY VISITS */
  const todaySql = `
    SELECT COUNT(*) AS today
    FROM visitor_logs
    WHERE visit_date = ?
  `;

  /* TOTAL VISITS */
  const totalSql = `
    SELECT COUNT(*) AS total
    FROM visitor_logs
  `;

  db.query(todaySql, [today], (err, todayResult) => {

    if (err) {
      console.log("TODAY ERROR:", err);
      return res.json({
        today: 0,
        total: 0
      });
    }

    db.query(totalSql, (err, totalResult) => {

      if (err) {
        console.log("TOTAL ERROR:", err);
        return res.json({
          today: todayResult[0].today,
          total: 0
        });
      }

      res.json({
        today: todayResult[0].today,
        total: totalResult[0].total
      });

    });

  });

});


/* =========================
   RESET ALL DATA
========================= */

router.delete("/reset", (req, res) => {

  const sql = `TRUNCATE TABLE visitor_logs`;

  db.query(sql, (err) => {

    if (err) {
      console.log("RESET ERROR:", err);
      return res.json({
        success: false,
        message: "Reset failed"
      });
    }

    res.json({
      success: true,
      message: "All data cleared"
    });

  });

});


module.exports = router;