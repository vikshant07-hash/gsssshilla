const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");

const db = require("../config/db");
const q = (sql, params = []) => db.query(sql, params);

// ============================================================
// AUTH
// ============================================================
const requireAdmin = (req, res, next) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
};

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
  return isNaN(dt) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const maskAadhar = (a) => {
  if (!a) return "—";
  const s = String(a).replace(/\s/g, "");
  if (s.length < 4) return "XXXX XXXX XXXX";
  return "XXXX XXXX " + s.substring(s.length - 4);
};

// ============================================================
// DRAW ONE ID CARD (front or back) at given position
// ============================================================
const drawCard = async (doc, x, y, W, H, s, logoBuf, principalBuf, photoBuf, signatureBuf, qrBuf, side) => {
  const CARD_GOLD = "#c9972b";
  const CARD_DARK = "#0d1b2a";
  const CARD_TEXT = "#1a2332";
  const CARD_MUTED = "#5a6a7e";

  // ---- OUTER BORDER (rounded look via two rects) ----
  doc.rect(x, y, W, H).fillAndStroke("#ffffff", CARD_DARK).lineWidth(1).stroke();
  doc.rect(x + 2, y + 2, W - 4, H - 4).lineWidth(0.6).strokeColor(CARD_GOLD).stroke();

  // ==================== FRONT SIDE ====================
  if (side === "front") {
    // Header band
    doc.rect(x + 2, y + 2, W - 4, 22).fill(CARD_DARK);
    doc.rect(x + 2, y + 22, W - 4, 2).fill(CARD_GOLD);

    // Logo
    if (logoBuf) {
      try { doc.image(logoBuf, x + 5, y + 5, { width: 16, height: 16 }); } catch (e) {}
    }

    // School name
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7)
      .text("GOVT. SR. SEC. SCHOOL SHILLA", x + 24, y + 5, { width: W - 30, align: "left" });
    doc.font("Helvetica").fontSize(4.5).fillColor(CARD_GOLD)
      .text("Shilla • Nerwa • Distt. Shimla • HP - 171210", x + 24, y + 14, { width: W - 30, align: "left" });

    // Photo box (left)
    const photoX = x + 6;
    const photoY = y + 30;
    const photoW = 32;
    const photoH = 42;
    doc.rect(photoX, photoY, photoW, photoH).fillAndStroke("#f1f5f9", CARD_GOLD).lineWidth(0.8).stroke();
    if (photoBuf) {
      try { doc.image(photoBuf, photoX + 1, photoY + 1, { width: photoW - 2, height: photoH - 2 }); } catch (e) {}
    } else {
      doc.font("Helvetica").fontSize(5).fillColor(CARD_MUTED)
        .text("PHOTO", photoX, photoY + 18, { width: photoW, align: "center" });
    }

    // Student info (right of photo)
    const infoX = photoX + photoW + 4;
    const infoW = W - (infoX - x) - 6;
    let infoY = y + 30;

    const rowData = [
      ["NAME", s.name],
      ["FATHER", s.father_name || "—"],
      ["MOTHER", s.mother_name || "—"],
      ["DOB", fmtDate(s.dob)]
    ];

    doc.font("Helvetica-Bold").fontSize(4).fillColor(CARD_GOLD);
    doc.font("Helvetica").fontSize(5).fillColor(CARD_TEXT);

    for (const [label, val] of rowData) {
      doc.font("Helvetica-Bold").fontSize(4).fillColor(CARD_GOLD)
        .text(label, infoX, infoY, { width: infoW });
      doc.font("Helvetica-Bold").fontSize(6).fillColor(CARD_TEXT)
        .text(String(val).substring(0, 28), infoX, infoY + 4.5, { width: infoW });
      infoY += 10;
    }

    // Student ID + class/roll (bottom band)
    const bandY = y + H - 22;
    doc.rect(x + 2, bandY, W - 4, 20).fillAndStroke("#fef8ed", CARD_GOLD).lineWidth(0.5).stroke();

    doc.font("Helvetica-Bold").fontSize(4).fillColor(CARD_MUTED)
      .text("STUDENT ID", x + 5, bandY + 3, { width: 40 });
    doc.font("Helvetica-Bold").fontSize(6).fillColor(CARD_DARK)
      .text(s.student_id || "—", x + 5, bandY + 8, { width: 45 });

    doc.font("Helvetica-Bold").fontSize(4).fillColor(CARD_MUTED)
      .text("CLASS", x + 55, bandY + 3, { width: 30 });
    doc.font("Helvetica-Bold").fontSize(6).fillColor(CARD_DARK)
      .text(String(s.class || "—"), x + 55, bandY + 8, { width: 30 });

    doc.font("Helvetica-Bold").fontSize(4).fillColor(CARD_MUTED)
      .text("ROLL NO", x + 85, bandY + 3, { width: 30 });
    doc.font("Helvetica-Bold").fontSize(6).fillColor(CARD_DARK)
      .text(s.roll_number || "—", x + 85, bandY + 8, { width: 30 });

    doc.font("Helvetica-Bold").fontSize(4).fillColor(CARD_MUTED)
      .text("SESSION", x + 120, bandY + 3, { width: 40 });
    doc.font("Helvetica-Bold").fontSize(5.5).fillColor(CARD_DARK)
      .text(s.session || "—", x + 120, bandY + 8, { width: 50 });
  }

  // ==================== BACK SIDE ====================
  if (side === "back") {
    // Header band
    doc.rect(x + 2, y + 2, W - 4, 16).fill(CARD_DARK);
    doc.rect(x + 2, y + 16, W - 4, 2).fill(CARD_GOLD);

    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7)
      .text("STUDENT INFORMATION", x + 4, y + 5, { width: W - 8, align: "center" });

    // Aadhar + APAAR
    let infoY = y + 24;

    doc.font("Helvetica-Bold").fontSize(4).fillColor(CARD_GOLD)
      .text("AADHAR NUMBER", x + 5, infoY);
    doc.font("Helvetica").fontSize(5.5).fillColor(CARD_TEXT)
      .text(maskAadhar(s.aadhar_number), x + 5, infoY + 5, { width: W - 10 });

    doc.font("Helvetica-Bold").fontSize(4).fillColor(CARD_GOLD)
      .text("APAAR ID", x + 5, infoY + 14);
    doc.font("Helvetica").fontSize(5.5).fillColor(CARD_TEXT)
      .text(s.apaar_id || "—", x + 5, infoY + 19, { width: W - 10 });

    infoY += 30;

    // Mobile + Email
    doc.font("Helvetica-Bold").fontSize(4).fillColor(CARD_GOLD)
      .text("MOBILE", x + 5, infoY);
    doc.font("Helvetica").fontSize(5.5).fillColor(CARD_TEXT)
      .text(s.mobile_number || "—", x + 5, infoY + 5, { width: W - 10 });

    doc.font("Helvetica-Bold").fontSize(4).fillColor(CARD_GOLD)
      .text("EMAIL", x + 5, infoY + 14);
    doc.font("Helvetica").fontSize(4.5).fillColor(CARD_TEXT)
      .text(s.email_id || "—", x + 5, infoY + 19, { width: W - 10, ellipsis: true });

    infoY += 30;

    // Address
    const fullAddr = [
      s.village,
      s.post_office ? "PO " + s.post_office : "",
      s.tehsil ? "Teh. " + s.tehsil : "",
      s.district ? "Distt. " + s.district : "",
      s.state,
      s.pincode
    ].filter(Boolean).join(", ") || s.address || "—";

    doc.font("Helvetica-Bold").fontSize(4).fillColor(CARD_GOLD)
      .text("ADDRESS", x + 5, infoY);
    doc.font("Helvetica").fontSize(4.5).fillColor(CARD_TEXT)
      .text(fullAddr, x + 5, infoY + 5, { width: W - 10, height: 16, ellipsis: true });

    infoY += 26;

    // QR code + principal signature
    const qrSize = 26;
    const qrX = x + 6;
    const qrY = y + H - qrSize - 10;

    if (qrBuf) {
      try {
        doc.rect(qrX - 1, qrY - 1, qrSize + 2, qrSize + 2).strokeColor(CARD_GOLD).lineWidth(0.5).stroke();
        doc.image(qrBuf, qrX, qrY, { width: qrSize, height: qrSize });
      } catch (e) {}
    }

    doc.font("Helvetica").fontSize(3.5).fillColor(CARD_MUTED)
      .text("Scan to verify", qrX - 2, qrY + qrSize + 1, { width: qrSize + 4, align: "center" });

    // Principal signature
    const sigX = x + W - 55;
    const sigY = y + H - 32;

    if (principalBuf) {
      try { doc.image(principalBuf, sigX + 10, sigY, { width: 30, height: 16 }); } catch (e) {}
    }

    doc.moveTo(sigX + 5, sigY + 20).lineTo(sigX + 45, sigY + 20).lineWidth(0.5).strokeColor(CARD_DARK).stroke();
    doc.font("Helvetica-Bold").fontSize(4).fillColor(CARD_DARK)
      .text("Principal", sigX + 5, sigY + 22, { width: 40, align: "center" });
    doc.font("Helvetica").fontSize(3.5).fillColor(CARD_MUTED)
      .text("GSSS Shilla", sigX + 5, sigY + 27, { width: 40, align: "center" });

    // Footer line
    doc.font("Helvetica-Oblique").fontSize(3).fillColor(CARD_MUTED)
      .text("If found, please return to school office", x + 2, y + H - 6, { width: W - 4, align: "center" });
  }
};

// ============================================================
// GENERATE SINGLE ID CARD PDF (Front + Back side by side)
// ============================================================
router.get("/generate/:studentId/pdf", requireAdmin, async (req, res) => {
  try {
    const { studentId } = req.params;

    const rows = await q("SELECT * FROM Nstudent WHERE student_id = ?", [studentId]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Student not found" });
    const s = rows[0];

    // Fetch images
    const logoBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/logo(1).png");
    const principalBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/principal.png");
    const photoBuf = await fetchImageBuffer(s.student_photo_url);
    const signatureBuf = await fetchImageBuffer(s.signature_url);

    // QR code
    const qrData = `ID:${s.student_id}|Class:${s.class}|Roll:${s.roll_number}|Name:${s.name}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;
    const qrBuf = await fetchImageBuffer(qrUrl);

    // A4 landscape PDF
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="idcard-${studentId}.pdf"`);
    doc.pipe(res);

    const PW = doc.page.width;
    const PH = doc.page.height;

    // Title
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
      .text("STUDENT IDENTITY CARD", 0, 20, { width: PW, align: "center" });

    // Card dimensions (credit card size scaled up: 1.6x for readability)
    const cardW = 220;
    const cardH = 138;
    const gap = 30;
    const totalW = cardW * 2 + gap;
    const startX = (PW - totalW) / 2;
    const startY = (PH - cardH) / 2;

    // FRONT (left) + BACK (right)
    await drawCard(doc, startX, startY, cardW, cardH, s, logoBuf, principalBuf, photoBuf, signatureBuf, qrBuf, "front");
    await drawCard(doc, startX + cardW + gap, startY, cardW, cardH, s, logoBuf, principalBuf, photoBuf, signatureBuf, qrBuf, "back");

    // Labels below cards
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#5a6a7e")
      .text("FRONT SIDE", startX, startY + cardH + 10, { width: cardW, align: "center" });
    doc.text("BACK SIDE", startX + cardW + gap, startY + cardH + 10, { width: cardW, align: "center" });

    // Instructions
    doc.font("Helvetica").fontSize(6).fillColor("#94a3b8")
      .text("• Print on 300 GSM cardstock or PVC card", 0, PH - 50, { width: PW, align: "center" });
    doc.text("• Laminate for durability", 0, PH - 40, { width: PW, align: "center" });
    doc.text(`• Generated on ${new Date().toLocaleDateString("en-IN")}`, 0, PH - 30, { width: PW, align: "center" });

    doc.end();
  } catch (err) {
    console.error("❌ ID Card PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// GENERATE BULK ID CARDS PDF (Whole class — multiple pages)
// ============================================================
router.get("/generate-class/:class/pdf", requireAdmin, async (req, res) => {
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

    // Fetch shared assets (logo + principal)
    const logoBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/logo(1).png");
    const principalBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/principal.png");

    // A4 landscape — 2 students per page (2 cards each side by side)
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="idcards-class${cls}.pdf"`);
    doc.pipe(res);

    const PW = doc.page.width;
    const PH = doc.page.height;

    const cardW = 220;
    const cardH = 138;
    const gap = 20;
    const totalW = cardW * 2 + gap;
    const startX = (PW - totalW) / 2;

    // Two rows per page
    const rowGap = 30;
    const totalH = cardH * 2 + rowGap;
    const startY = (PH - totalH) / 2 + 5;

    let slot = 0; // 0,1 per page (top row), 2,3 (bottom row)
    let pageCount = 1;

    for (let i = 0; i < students.length; i++) {
      const s = students[i];

      // Fetch per-student assets
      const photoBuf = await fetchImageBuffer(s.student_photo_url);
      const signatureBuf = await fetchImageBuffer(s.signature_url);
      const qrData = `ID:${s.student_id}|Class:${s.class}|Roll:${s.roll_number}|Name:${s.name}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;
      const qrBuf = await fetchImageBuffer(qrUrl);

      // Position
      const isTopRow = slot < 2;
      const col = slot % 2;
      const cardX = startX + col * (cardW + gap);
      const cardY = startY + (isTopRow ? 0 : cardH + rowGap);

      await drawCard(doc, cardX, cardY, cardW, cardH, s, logoBuf, principalBuf, photoBuf, signatureBuf, qrBuf, "front");
      await drawCard(doc, cardX + cardW + gap, cardY, cardW, cardH, s, logoBuf, principalBuf, photoBuf, signatureBuf, qrBuf, "back");

      slot += 1;

      // Every student occupies a full row (front + back side by side)
      // So 2 students per page (top + bottom row)
      // When slot reaches 2, we've filled the page
      if (slot === 2 && i < students.length - 1) {
        // Save current drawing state and add page
        doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
        slot = 0;
        pageCount++;
      }
    }

    // Footer
    doc.font("Helvetica").fontSize(6).fillColor("#94a3b8")
      .text(`Class ${cls} — ${students.length} students — Total ${pageCount} page(s)`, 0, PH - 15, { width: PW, align: "center" });

    doc.end();
  } catch (err) {
    console.error("❌ Bulk ID Card PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
