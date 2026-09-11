const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");

const db = require("../config/db");
const q = (sql, params = []) => db.query(sql, params);

// ============================================================
// HELPERS
// ============================================================
const fetchImageBuffer = (url) => new Promise((resolve) => {
  if (!url) return resolve(null);
  const client = url.startsWith("https") ? https : http;
  client.get(url, (resp) => {
    if (resp.statusCode !== 200) return resolve(null);
    const chunks = [];
    resp.on("data", c => chunks.push(c));
    resp.on("end", () => resolve(Buffer.concat(chunks)));
  }).on("error", () => resolve(null));
});

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const maskAadhar = (a) => {
  if (!a) return "—";
  const s = String(a).replace(/\s/g, "");
  if (s.length < 4) return "XXXX XXXX XXXX";
  return "XXXX XXXX " + s.substring(s.length - 4);
};

// ============================================================
// DRAW ONE CARD (Front or Back) — Word-style banner layout
// Card size: 250 × 158 pt (= 88mm × 55mm approximately)
// ============================================================
const drawCard = async (doc, x, y, W, H, s, logoBuf, principalBuf, photoBuf, signatureBuf, qrBuf, side) => {
  const CARD_BLUE = "#1e3a8a";
  const CARD_GREEN = "#16a34a";
  const CARD_GOLD = "#c9972b";
  const CARD_DARK = "#0d1b2a";
  const CARD_TEXT = "#1a2332";
  const CARD_MUTED = "#5a6a7e";
  const CARD_LIGHT = "#f8fafc";

  // ==================== OUTER BORDER ====================
  doc.rect(x, y, W, H).fillAndStroke("#ffffff", CARD_DARK).lineWidth(1.5).stroke();
  doc.rect(x + 2, y + 2, W - 4, H - 4).lineWidth(0.5).strokeColor(CARD_GOLD).stroke();

  // ==================== FRONT SIDE ====================
  if (side === "front") {
    // ---- BLUE BANNER HEADER ----
    doc.rect(x + 2, y + 2, W - 4, 32).fill(CARD_BLUE);

    // Logo (left side of banner)
    if (logoBuf) {
      try { doc.image(logoBuf, x + 5, y + 5, { width: 26, height: 26 }); } catch (e) {}
    } else {
      doc.circle(x + 18, y + 18, 13).strokeColor("#ffffff").lineWidth(1).stroke();
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10).text("🏛", x + 8, y + 11);
    }

    // School name (center of banner)
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11)
      .text("GOVT. SR. SEC. SCHOOL SHILLA", x + 36, y + 6, { width: W - 42, align: "center" });
    doc.font("Helvetica").fontSize(6).fillColor("#e0e7ff")
      .text("Shilla • Nerwa • Distt. Shimla • HP - 171210", x + 36, y + 20, { width: W - 42, align: "center" });

    // ---- GREEN "ID CARD" BADGE ----
    const badgeW = 60;
    const badgeX = x + (W - badgeW) / 2;
    doc.roundedRect(badgeX, y + 36, badgeW, 12, 6).fill(CARD_GREEN);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7)
      .text("ID CARD", badgeX, y + 39, { width: badgeW, align: "center", characterSpacing: 1 });

    // ---- PHOTO (Right side) ----
    const photoW = 50;
    const photoH = 60;
    const photoX = x + W - photoW - 8;
    const photoY = y + 55;

    doc.rect(photoX - 1, photoY - 1, photoW + 2, photoH + 2).strokeColor(CARD_GOLD).lineWidth(0.5).stroke();
    if (photoBuf) {
      try { doc.image(photoBuf, photoX, photoY, { width: photoW, height: photoH }); } catch (e) {}
    } else {
      doc.rect(photoX, photoY, photoW, photoH).fillAndStroke(CARD_LIGHT, "#cbd5e1");
      doc.font("Helvetica").fontSize(6).fillColor(CARD_MUTED)
        .text("PHOTO", photoX, photoY + 27, { width: photoW, align: "center" });
    }

    // ---- STUDENT SIGNATURE (below photo) ----
    const sigY = photoY + photoH + 3;
    if (signatureBuf) {
      try { doc.image(signatureBuf, photoX, sigY, { width: photoW, height: 12 }); } catch (e) {}
    }
    doc.moveTo(photoX + 5, sigY + 14).lineTo(photoX + photoW - 5, sigY + 14).lineWidth(0.4).strokeColor(CARD_MUTED).stroke();
    doc.font("Helvetica").fontSize(5).fillColor(CARD_MUTED)
      .text("Student Signature", photoX, sigY + 16, { width: photoW, align: "center" });

    // ---- DETAILS TABLE (Left side) ----
    const infoX = x + 8;
    const infoYStart = y + 55;
    const labelW = 50;
    const valueW = W - labelW - photoW - 25;
    const rowH = 11;

    const rows = [
      ["Name", (s.name || "—").substring(0, 22)],
      ["Father's Name", (s.father_name || "—").substring(0, 22)],
      ["Mother's Name", (s.mother_name || "—").substring(0, 22)],
      ["D.O.B.", fmtDate(s.dob)],
      ["Class", `${s.class || "—"}${["11","12"].includes(String(s.class)) ? " - " + (s.stream || "") : ""}`],
      ["Roll No.", s.roll_number || "—"],
      ["Student ID", s.student_id || "—"],
      ["Session", s.session || "—"]
    ];

    rows.forEach(([label, val], i) => {
      const rowY = infoYStart + i * rowH;

      // Label
      doc.font("Helvetica-Bold").fontSize(6).fillColor(CARD_TEXT)
        .text(label, infoX, rowY, { width: labelW });
      // Separator
      doc.font("Helvetica-Bold").fontSize(6).fillColor(CARD_TEXT)
        .text(":", infoX + labelW - 3, rowY, { width: 5 });
      // Value
      doc.font("Helvetica").fontSize(6).fillColor(CARD_TEXT)
        .text(String(val), infoX + labelW + 2, rowY, { width: valueW });
    });

    // ---- PRINCIPAL SIGNATURE (bottom right, below student signature) ----
    const pSigX = photoX - 5;
    const pSigY = y + H - 22;

    if (principalBuf) {
      try { doc.image(principalBuf, pSigX + 8, pSigY - 6, { width: 34, height: 16 }); } catch (e) {}
    }
    doc.moveTo(pSigX + 2, pSigY + 10).lineTo(pSigX + 48, pSigY + 10).lineWidth(0.4).strokeColor(CARD_MUTED).stroke();
    doc.font("Helvetica-Bold").fontSize(5).fillColor(CARD_DARK)
      .text("Principal", pSigX, pSigY + 12, { width: 50, align: "center" });
  }

  // ==================== BACK SIDE ====================
  if (side === "back") {
    // ---- BLUE BANNER HEADER ----
    doc.rect(x + 2, y + 2, W - 4, 32).fill(CARD_BLUE);

    if (logoBuf) {
      try { doc.image(logoBuf, x + 5, y + 5, { width: 26, height: 26 }); } catch (e) {}
    }

    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11)
      .text("GOVT. SR. SEC. SCHOOL SHILLA", x + 36, y + 6, { width: W - 42, align: "center" });
    doc.font("Helvetica").fontSize(6).fillColor("#e0e7ff")
      .text("Shilla • Nerwa • Distt. Shimla • HP - 171210", x + 36, y + 20, { width: W - 42, align: "center" });

    // ---- GREEN BADGE ----
    const badgeW = 70;
    const badgeX = x + (W - badgeW) / 2;
    doc.roundedRect(badgeX, y + 36, badgeW, 12, 6).fill(CARD_GREEN);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7)
      .text("SCHOOL ADDRESS & CONTACT", badgeX, y + 39, { width: badgeW, align: "center" });

    // ---- DETAILS ----
    const infoX = x + 8;
    const infoYStart = y + 55;
    const labelW = 55;
    const rowH = 12;

    const fullAddr = [
      s.village,
      s.post_office ? "PO " + s.post_office : "",
      s.tehsil ? "Teh. " + s.tehsil : "",
      s.district ? "Distt. " + s.district : "",
      s.state,
      s.pincode
    ].filter(Boolean).join(", ") || s.address || "—";

    const rows = [
      ["Address", fullAddr.substring(0, 60)],
      ["Mobile No.", s.mobile_number || "—"],
      ["Email", s.email_id || "—"],
      ["Aadhar No.", maskAadhar(s.aadhar_number)],
      ["APAAR ID", s.apaar_id || "—"],
      ["Issue Date", fmtDate(new Date())]
    ];

    rows.forEach(([label, val], i) => {
      const rowY = infoYStart + i * rowH;

      doc.font("Helvetica-Bold").fontSize(6).fillColor(CARD_TEXT)
        .text(label, infoX, rowY, { width: labelW });
      doc.font("Helvetica-Bold").fontSize(6).fillColor(CARD_TEXT)
        .text(":", infoX + labelW - 3, rowY, { width: 5 });
      doc.font("Helvetica").fontSize(6).fillColor(CARD_TEXT)
        .text(String(val), infoX + labelW + 2, rowY, { width: W - labelW - 20 });
    });

    // ---- QR CODE (bottom right) ----
    const qrSize = 42;
    const qrX = x + W - qrSize - 8;
    const qrY = y + H - qrSize - 8;

    if (qrBuf) {
      try {
        doc.rect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4).strokeColor(CARD_GOLD).lineWidth(0.5).stroke();
        doc.image(qrBuf, qrX, qrY, { width: qrSize, height: qrSize });
      } catch (e) {}
    }

    doc.font("Helvetica-Bold").fontSize(4.5).fillColor(CARD_DARK)
      .text("SCAN TO VERIFY", qrX - 5, qrY + qrSize + 2, { width: qrSize + 10, align: "center" });

    // ---- Principal Signature (bottom left) ----
    const sigX = x + 15;
    const sigY = y + H - 22;

    if (principalBuf) {
      try { doc.image(principalBuf, sigX + 8, sigY - 6, { width: 34, height: 16 }); } catch (e) {}
    }
    doc.moveTo(sigX + 2, sigY + 10).lineTo(sigX + 48, sigY + 10).lineWidth(0.4).strokeColor(CARD_MUTED).stroke();
    doc.font("Helvetica-Bold").fontSize(5).fillColor(CARD_DARK)
      .text("Principal", sigX, sigY + 12, { width: 50, align: "center" });
  }
};

// ============================================================
// GENERATE SINGLE ID CARD PDF
// ============================================================
router.get("/generate/:studentId/pdf", async (req, res) => {
  try {
    const { studentId } = req.params;

    const rows = await q("SELECT * FROM Nstudent WHERE student_id = ?", [studentId]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Student not found" });
    const s = rows[0];

    const logoBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/logo(1).png");
    const principalBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/principal.png");
    const photoBuf = await fetchImageBuffer(s.student_photo_url);
    const signatureBuf = await fetchImageBuffer(s.signature_url);
    const qrData = `ID:${s.student_id}|Class:${s.class}|Roll:${s.roll_number}|Name:${s.name}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;
    const qrBuf = await fetchImageBuffer(qrUrl);

    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="idcard-${studentId}.pdf"`);
    doc.pipe(res);

    const PW = doc.page.width;
    const PH = doc.page.height;

    const cardW = 250;
    const cardH = 158;
    const gap = 40;
    const totalW = cardW * 2 + gap;
    const startX = (PW - totalW) / 2;
    const startY = (PH - cardH) / 2;

    await drawCard(doc, startX, startY, cardW, cardH, s, logoBuf, principalBuf, photoBuf, signatureBuf, qrBuf, "front");
    await drawCard(doc, startX + cardW + gap, startY, cardW, cardH, s, logoBuf, principalBuf, photoBuf, signatureBuf, qrBuf, "back");

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#5a6a7e")
      .text("FRONT SIDE", startX, startY + cardH + 15, { width: cardW, align: "center" });
    doc.text("BACK SIDE", startX + cardW + gap, startY + cardH + 15, { width: cardW, align: "center" });

    doc.font("Helvetica").fontSize(7).fillColor("#94a3b8")
      .text("• Print on 300 GSM cardstock or PVC • Laminate for durability",
        0, PH - 40, { width: PW, align: "center" });

    doc.end();
  } catch (err) {
    console.error("❌ ID Card PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// GENERATE BULK ID CARDS PDF — 4 students per A4 page (2×2)
// ============================================================
router.get("/generate-class/:class/pdf", async (req, res) => {
  try {
    const { class: cls } = req.params;
    const { session } = req.query;

    const where = ["class = ?"];
    const params = [cls];
    if (session) { where.push("session = ?"); params.push(session); }

    const students = await q(
      `SELECT * FROM Nstudent WHERE ${where.join(" AND ")} ORDER BY CAST(roll_number AS UNSIGNED) ASC, name ASC`,
      params
    );

    if (!students.length) {
      return res.status(404).json({ success: false, message: "No students found in this class" });
    }

    const logoBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/logo(1).png");
    const principalBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/principal.png");

    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="idcards-class${cls}.pdf"`);
    doc.pipe(res);

    const PW = doc.page.width;   // ~841
    const PH = doc.page.height;  // ~595

    // 2×2 grid = 4 students per page
    // Each student = front + back side by side
    const cardW = 250;
    const cardH = 158;
    const innerGap = 20;   // gap between front and back
    const colGap = 15;      // gap between columns
    const rowGap = 15;      // gap between rows

    // Total width per student = cardW * 2 + innerGap
    const studentW = cardW * 2 + innerGap;
    const studentH = cardH;

    // Grid: 2 columns × 2 rows
    const totalW = studentW * 2 + colGap;
    const totalH = studentH * 2 + rowGap;

    const startX = (PW - totalW) / 2;
    const startY = (PH - totalH) / 2 + 5;

    let slot = 0;
    let pageCount = 1;

    for (let i = 0; i < students.length; i++) {
      const s = students[i];

      const photoBuf = await fetchImageBuffer(s.student_photo_url);
      const signatureBuf = await fetchImageBuffer(s.signature_url);
      const qrData = `ID:${s.student_id}|Class:${s.class}|Roll:${s.roll_number}|Name:${s.name}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;
      const qrBuf = await fetchImageBuffer(qrUrl);

      const rowIdx = Math.floor(slot / 2);
      const colIdx = slot % 2;

      const studentX = startX + colIdx * (studentW + colGap);
      const studentY = startY + rowIdx * (studentH + rowGap);

      // Front at studentX
      await drawCard(doc, studentX, studentY, cardW, cardH, s, logoBuf, principalBuf, photoBuf, signatureBuf, qrBuf, "front");
      // Back at studentX + cardW + innerGap
      await drawCard(doc, studentX + cardW + innerGap, studentY, cardW, cardH, s, logoBuf, principalBuf, photoBuf, signatureBuf, qrBuf, "back");

      slot++;

      if (slot === 4 && i < students.length - 1) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
        slot = 0;
        pageCount++;
      }
    }

    doc.font("Helvetica").fontSize(6).fillColor("#94a3b8")
      .text(`Class ${cls} — ${students.length} students — Page 1 of ${pageCount}`,
        0, PH - 15, { width: PW, align: "center" });

    doc.end();
  } catch (err) {
    console.error("❌ Bulk ID Card PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
