const db = require("../config/db");


// ==========================
// GET STUDENTS (FULL DETAILS)
// ==========================
exports.getStudents = (req, res) => {
  const status = req.query.status;

  const sql = `
    SELECT * FROM students
    WHERE status=?
    ORDER BY id DESC
  `;

  db.query(sql, [status], (err, data) => {
    if (err) {
      console.log("DB ERROR:", err);
      return res.status(500).json({
        success: false,
        message: "Database error"
      });
    }

    res.json({
      success: true,
      data
    });
  });
};

// ==========================
// APPROVE STUDENT + LOGIN GENERATION + EMAIL
// ==========================
exports.approve = (req, res) => {
  const id = req.params.id;

  db.query("SELECT * FROM students WHERE id=?", [id], async (err, result) => {
    if (err || !result.length) {
      return res.status(404).json({
        success: false,
        message: "Student not found"
      });
    }

    const student = result[0];

    // ==========================
    // PASSWORD GENERATION LOGIC
    // ==========================
    const namePart = (student.name || "").slice(0, 2).toUpperCase();

    let dobPart = "";
    if (student.dob) {
      const d = new Date(student.dob);
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      dobPart = dd + mm + yyyy;
    }

    const fatherPart = (student.father_name || "").slice(0, 2).toUpperCase();

    const password = namePart + dobPart + fatherPart;
    const username = student.email;

    // ==========================
    // UPDATE DB (IMPORTANT ORDER)
    // ==========================
    db.query(
      `UPDATE students 
       SET status='approved', username=?, password=?, remark=NULL 
       WHERE id=?`,
      [username, password, id],
      async (updateErr) => {
        if (updateErr) {
          console.log("UPDATE ERROR:", updateErr);
          return res.status(500).json({
            success: false,
            message: "Update failed"
          });
        }

        // ==========================
        // EMAIL SEND
        // ==========================
        try {
          await sendMail(
            student.email,
            "🎉 Admission Approved + Login Details",
            `
Dear ${student.name},

🎉 Congratulations! Your admission is APPROVED.

LOGIN DETAILS:
Username: ${username}
Password: ${password}

⚠ Please change your password after first login.

Welcome to our institution.
            `
          );
        } catch (e) {
          console.log("EMAIL ERROR:", e.message);
        }

        res.json({
          success: true,
          message: "Approved + Credentials sent"
        });
      }
    );
  });
};

// ==========================
// CORRECTION + EMAIL
// ==========================
exports.correction = (req, res) => {
  const id = req.params.id;
  const remark = req.body.remark;

  db.query("SELECT * FROM students WHERE id=?", [id], async (err, result) => {
    if (err || !result.length) {
      return res.status(404).json({
        success: false,
        message: "Student not found"
      });
    }

    const student = result[0];

    db.query(
      "UPDATE students SET status='correction', remark=? WHERE id=?",
      [remark, id],
      async (updateErr) => {
        if (updateErr) {
          console.log("UPDATE ERROR:", updateErr);
          return res.status(500).json({
            success: false,
            message: "Update failed"
          });
        }

        try {
          await sendMail(
            student.email,
            "⚠ Form Correction Required",
            `
Dear ${student.name},

Your admission form requires correction.

Remark: ${remark}

Please login and resubmit the form.
            `
          );
        } catch (e) {
          console.log("EMAIL ERROR:", e.message);
        }

        res.json({
          success: true,
          message: "Correction sent + Email delivered"
        });
      }
    );
  });
};