const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");

const db = require("../config/db");
const q = (sql, params = []) => db.query(sql, params);

// ============================================================
// SCHOOL CONFIG — change here, reflects everywhere
// ============================================================
const SCHOOL = {
  name: "GOVT. SR. SEC. SCHOOL SHILLA",
  address: "Shilla • Nerwa • Distt. Shimla • HP - 171210",
  logoUrl: "https://gsssshilla07.pages.dev/logo(1).png",
  principalUrl: "https://gsssshilla07.pages.dev/principal.png",
};

// ============================================================
// CARD GEOMETRY — CR80 standard size (3.375in x 2.125in)
// This is the same physical size as a real ATM/PVC card.
// ============================================================
const CARD_W = 243;   // 3.375in * 72pt
const CARD_H = 153;   // 2.125in * 72pt

// ============================================================
// COLOR THEME (gradient based)
// ============================================================
const THEME = {
  blueStart: "#1e3a8a",
  blueEnd: "#3b5bdb",
  goldStart: "#c9972b",
  goldEnd: "#f0c869",
  dark: "#0d1b2a",
  text: "#1a2332",
  muted: "#64748a",
  light: "#f8fafc",
  border: "#d8dee8",
};

// ============================================================
// HELPERS
// ============================================================
const fetchImageBuffer = (url) => new Promise((resolve) => {
  if (!url) return resolve(null);
  const client = url.startsWith("https") ? https : http;
  const req = client.get(url, (resp) => {
    if (resp.statusCode !== 200) return resolve(null);
    const chunks = [];
    resp.on("data", (c) => chunks.push(c));
    resp.on("end", () => resolve(Buffer.concat(chunks)));
  });
  req.on("error", () => resolve(null));
  req.setTimeout(8000, () => { req.destroy(); resolve(null); });
});

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const maskAadhar = (a) => {
  if (!a) return "—";
  const s = String(a).replace(/\s/g, "");
  if (s.length < 4) return "XXXX XXXX XXXX";
  return "XXXX XXXX " + s.substring(s.length - 4);
};

const sessionValidUpto = (session) => {
  if (!session) return "—";
  const parts = String(session).split(/[-/]/);
  const endYear = parts[1] ? parts[1].trim() : parts[0];
  return endYear && endYear.length === 2 ? "20" + endYear : (endYear || "—");
};

// Small L-shaped crop/cut marks at the outer corners of a rect.
// These sit in the gutter between cards so the printed sheet can
// be trimmed accurately without cutting into card content.
function drawCutMarks(doc, x, y, w, h, len = 7, offset = 3, color = "#9aa5b1") {
  doc.save().lineWidth(0.5).strokeColor(color);
  const corners = [
    { cx: x, cy: y, dx: -1, dy: -1 },
    { cx: x + w, cy: y, dx: 1, dy: -1 },
    { cx: x, cy: y + h, dx: -1, dy: 1 },
    { cx: x + w, cy: y + h, dx: 1, dy: 1 },
  ];
  corners.forEach(({ cx, cy, dx, dy }) => {
    doc.moveTo(cx + dx * offset, cy).lineTo(cx + dx * (offset + len), cy).stroke();
    doc.moveTo(cx, cy + dy * offset).lineTo(cx, cy + dy * (offset + len)).stroke();
  });
  doc.restore();
}

// ============================================================
// DRAW ONE CARD (Front or Back) — gradient banner, CR80 sizing
// ============================================================
const drawCard = (doc, x, y, s, buf, side) => {
  const W = CARD_W, H = CARD_H;
  const { logoBuf, principalBuf, photoBuf, signatureBuf, qrBuf } = buf;

  // ---------- Outer card frame ----------
  doc.roundedRect(x, y, W, H, 7).fillAndStroke("#ffffff", THEME.dark);
  doc.lineWidth(1).stroke();
  doc.roundedRect(x + 2.5, y + 2.5, W - 5, H - 5, 5).lineWidth(0.6).strokeColor(THEME.goldStart).stroke();

  // ---------- Gradient header banner ----------
  const headerH = 24;
  const headerGrad = doc.linearGradient(x + 2, y + 2, x + W - 2, y + 2 + headerH);
  headerGrad.stop(0, THEME.blueStart).stop(1, THEME.blueEnd);
  doc.roundedRect(x + 2, y + 2, W - 4, headerH, 5).fill(headerGrad);

  // Logo
  if (logoBuf) {
    try { doc.image(logoBuf, x + 5, y + 4, { fit: [18, 18], align: "center", valign: "center" }); } catch (e) {}
  } else {
    doc.circle(x + 14, y + 13, 8).lineWidth(0.8).strokeColor("#ffffff").stroke();
  }

  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.3)
    .text(SCHOOL.name, x + 27, y + 5, { width: W - 32, align: "center" });
  doc.font("Helvetica").fontSize(5.2).fillColor("#e2e8ff")
    .text(SCHOOL.address, x + 27, y + 14.5, { width: W - 32, align: "center" });

  // ---------- Gold gradient badge ----------
  const badgeText = side === "front" ? "STUDENT ID CARD" : "ADDRESS & VERIFICATION";
  const badgeW = side === "front" ? 78 : 108;
  const badgeX = x + (W - badgeW) / 2;
  const badgeY = y + headerH + 3;
  const badgeGrad = doc.linearGradient(badgeX, badgeY, badgeX + badgeW, badgeY);
  badgeGrad.stop(0, THEME.goldStart).stop(1, THEME.goldEnd);
  doc.roundedRect(badgeX, badgeY, badgeW, 9.5, 4.75).fill(badgeGrad);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(5.6)
    .text(badgeText, badgeX, badgeY + 2.5, { width: badgeW, align: "center", characterSpacing: 0.4 });

  const contentY0 = y + headerH + 16; // start of body content

  // ============================================================
  if (side === "front") {
    // ---- Photo (right column) ----
    const photoW = 44, photoH = 54;
    const photoX = x + W - photoW - 7;
    const photoY = contentY0;

    doc.rect(photoX - 1.5, photoY - 1.5, photoW + 3, photoH + 3).lineWidth(0.6).strokeColor(THEME.goldStart).stroke();
    if (photoBuf) {
      try { doc.image(photoBuf, photoX, photoY, { fit: [photoW, photoH], align: "center", valign: "center" }); } catch (e) {}
    } else {
      doc.rect(photoX, photoY, photoW, photoH).fillAndStroke(THEME.light, THEME.border);
      doc.font("Helvetica").fontSize(5.6).fillColor(THEME.muted)
        .text("PHOTO", photoX, photoY + photoH / 2 - 3, { width: photoW, align: "center" });
    }

    // Student signature under photo
    const sigY = photoY + photoH + 3;
    if (signatureBuf) {
      try { doc.image(signatureBuf, photoX + 2, sigY, { fit: [photoW - 4, 10], align: "center", valign: "bottom" }); } catch (e) {}
    }
    doc.moveTo(photoX + 3, sigY + 11).lineTo(photoX + photoW - 3, sigY + 11).lineWidth(0.4).strokeColor(THEME.muted).stroke();
    doc.font("Helvetica").fontSize(4.6).fillColor(THEME.muted)
      .text("Student Signature", photoX, sigY + 12.5, { width: photoW, align: "center" });

    // ---- Info rows (left column) ----
    const infoX = x + 7;
    const labelW = 42;
    const valueW = photoX - infoX - labelW - 8;
    const rowH = 10;

    const rows = [
      ["Name", (s.name || "—")],
      ["Father's Name", (s.father_name || "—")],
      ["Mother's Name", (s.mother_name || "—")],
      ["D.O.B.", fmtDate(s.dob)],
      ["Class", `${s.class || "—"}${["11", "12"].includes(String(s.class)) ? " - " + (s.stream || "") : ""}`],
      ["Roll No.", s.roll_number || "—"],
      ["Student ID", s.student_id || "—"],
      ["Session", s.session || "—"],
    ];

    rows.forEach(([label, val], i) => {
      const rowY = contentY0 + i * rowH;
      doc.font("Helvetica-Bold").fontSize(5.8).fillColor(THEME.text)
        .text(label, infoX, rowY, { width: labelW, lineBreak: false });
      doc.text(":", infoX + labelW - 4, rowY, { width: 6, lineBreak: false });
      doc.font("Helvetica").fontSize(5.8).fillColor(THEME.text)
        .text(String(val).substring(0, 26), infoX + labelW + 2, rowY, { width: valueW, height: rowH, ellipsis: true, lineBreak: false });
    });

    // ---- Principal signature (bottom-left footer band) ----
    const footerY = y + H - 24;
    const sigBoxX = x + 12;
    if (principalBuf) {
      try { doc.image(principalBuf, sigBoxX + 6, footerY - 5, { fit: [36, 14], align: "center", valign: "bottom" }); } catch (e) {}
    }
    doc.moveTo(sigBoxX, footerY + 10).lineTo(sigBoxX + 48, footerY + 10).lineWidth(0.4).strokeColor(THEME.muted).stroke();
    doc.font("Helvetica-Bold").fontSize(5).fillColor(THEME.dark)
      .text("Principal", sigBoxX, footerY + 12, { width: 48, align: "center" });

    // ---- Right footer: card validity ----
    doc.font("Helvetica").fontSize(4.6).fillColor(THEME.muted)
      .text(`Valid upto: ${sessionValidUpto(s.session)}`, x + W - photoW - 7, footerY + 14, { width: photoW, align: "center" });
  }

  // ============================================================
  if (side === "back") {
    const infoX = x + 7;
    const labelW = 50;
    const rowH = 11;
    const valueW = W - labelW - 22;

    const fullAddr = [
      s.village,
      s.post_office ? "PO " + s.post_office : "",
      s.tehsil ? "Teh. " + s.tehsil : "",
      s.district ? "Distt. " + s.district : "",
      s.state,
      s.pincode,
    ].filter(Boolean).join(", ") || s.address || "—";

    const rows = [
      ["Address", fullAddr],
      ["Mobile No.", s.mobile_number || "—"],
      ["Email", s.email_id || "—"],
      ["Aadhar No.", maskAadhar(s.aadhar_number)],
      ["APAAR ID", s.apaar_id || "—"],
    ];

    rows.forEach(([label, val], i) => {
      const rowY = contentY0 + i * rowH;
      doc.font("Helvetica-Bold").fontSize(5.8).fillColor(THEME.text)
        .text(label, infoX, rowY, { width: labelW, lineBreak: false });
      doc.text(":", infoX + labelW - 4, rowY, { width: 6, lineBreak: false });
      doc.font("Helvetica").fontSize(5.8).fillColor(THEME.text)
        .text(String(val), infoX + labelW + 2, rowY, { width: valueW, height: rowH * 2, ellipsis: label !== "Address" });
    });

    // ---- QR code (bottom-right) ----
    const qrSize = 40;
    const qrX = x + W - qrSize - 8;
    const qrY = y + H - qrSize - 12;
    if (qrBuf) {
      try {
        doc.rect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4).lineWidth(0.6).strokeColor(THEME.goldStart).stroke();
        doc.image(qrBuf, qrX, qrY, { fit: [qrSize, qrSize] });
      } catch (e) {}
    }
    doc.font("Helvetica-Bold").fontSize(4.3).fillColor(THEME.dark)
      .text("SCAN TO VERIFY", qrX - 6, qrY + qrSize + 2, { width: qrSize + 12, align: "center" });

    // ---- Principal signature (bottom-left) ----
    const footerY = y + H - 24;
    const sigBoxX = x + 14;
    if (principalBuf) {
      try { doc.image(principalBuf, sigBoxX + 6, footerY - 5, { fit: [36, 14], align: "center", valign: "bottom" }); } catch (e) {}
    }
    doc.moveTo(sigBoxX, footerY + 10).lineTo(sigBoxX + 48, footerY + 10).lineWidth(0.4).strokeColor(THEME.muted).stroke();
    doc.font("Helvetica-Bold").fontSize(5).fillColor(THEME.dark)
      .text("Principal", sigBoxX, footerY + 12, { width: 48, align: "center" });

    doc.font("Helvetica").fontSize(4.3).fillColor(THEME.muted)
      .text(`Issued: ${fmtDate(new Date())}`, sigBoxX, footerY + 19, { width: 48, align: "center" });
  }
};

// ============================================================
// PAGE LAYOUT — Portrait A4, 5 students per page, front+back
// side-by-side per row, with cut marks in every gutter.
// This is the layout that keeps printing paper-efficient:
// one A4 sheet = 5 complete ID cards, ready to cut & laminate.
// ============================================================
const GAP_COL = 10;  // gap between front & back (cut gutter)
const GAP_ROW = 8;   // gap between rows (cut gutter)
const ROWS_PER_PAGE = 5;

function pageMetrics(doc) {
  const PW = doc.page.width;
  const PH = doc.page.height;
  const totalW = CARD_W * 2 + GAP_COL;
  const totalH = CARD_H * ROWS_PER_PAGE + GAP_ROW * (ROWS_PER_PAGE - 1);
  const startX = (PW - totalW) / 2;
  const startY = (PH - totalH) / 2;
  return { PW, PH, startX, startY };
}

async function buildBuffersFor(student, sharedLogoBuf, sharedPrincipalBuf) {
  const [photoBuf, signatureBuf] = await Promise.all([
    fetchImageBuffer(student.student_photo_url),
    fetchImageBuffer(student.signature_url),
  ]);
  const qrData = `ID:${student.student_id}|Class:${student.class}|Roll:${student.roll_number}|Name:${student.name}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;
  const qrBuf = await fetchImageBuffer(qrUrl);
  return { logoBuf: sharedLogoBuf, principalBuf: sharedPrincipalBuf, photoBuf, signatureBuf, qrBuf };
}

// Renders `students` (array) onto `doc`, 5 per page, front+back per row.
// Draws cut marks around every card and a light dashed guide across
// the full sheet width/height at each cut line for accurate trimming.
async function renderStudentsGrid(doc, students, sharedLogoBuf, sharedPrincipalBuf) {
  const { startX, startY } = pageMetrics(doc);

  for (let i = 0; i < students.length; i++) {
    const isNewPage = i > 0 && i % ROWS_PER_PAGE === 0;
    if (isNewPage) {
      doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
    }
    const rowIdx = i % ROWS_PER_PAGE;
    const rowY = startY + rowIdx * (CARD_H + GAP_ROW);
    const frontX = startX;
    const backX = startX + CARD_W + GAP_COL;

    const s = students[i];
    const buf = await buildBuffersFor(s, sharedLogoBuf, sharedPrincipalBuf);

    drawCard(doc, frontX, rowY, s, buf, "front");
    drawCard(doc, backX, rowY, s, buf, "back");

    drawCutMarks(doc, frontX, rowY, CARD_W, CARD_H);
    drawCutMarks(doc, backX, rowY, CARD_W, CARD_H);
  }
}

function drawPageFooter(doc, label) {
  const { PW, PH } = pageMetrics(doc);
  doc.font("Helvetica").fontSize(6.5).fillColor("#9aa5b1")
    .text(label, 0, PH - 12, { width: PW, align: "center" });
}

// ============================================================
// ROUTE: single student — same 5-slot grid, page kept efficient
// (top slot filled; remaining slots stay blank for now so a
// future "print together" workflow can reuse the same sheet).
// ============================================================
router.get("/generate/:studentId/pdf", async (req, res) => {
  try {
    const { studentId } = req.params;
    const rows = await q("SELECT * FROM Nstudent WHERE student_id = ?", [studentId]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Student not found" });
    const s = rows[0];

    const [logoBuf, principalBuf] = await Promise.all([
      fetchImageBuffer(SCHOOL.logoUrl),
      fetchImageBuffer(SCHOOL.principalUrl),
    ]);

    const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="idcard-${studentId}.pdf"`);
    doc.pipe(res);

    await renderStudentsGrid(doc, [s], logoBuf, principalBuf);
    drawPageFooter(doc, "Print on 300 GSM cardstock or PVC sheet • Cut along marks • Laminate for durability");

    doc.end();
  } catch (err) {
    console.error("❌ ID Card PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ROUTE: bulk class — 5 students per A4 sheet, front+back each,
// paginated automatically. Paper-efficient by design.
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

    const [logoBuf, principalBuf] = await Promise.all([
      fetchImageBuffer(SCHOOL.logoUrl),
      fetchImageBuffer(SCHOOL.principalUrl),
    ]);

    const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="idcards-class${cls}.pdf"`);
    doc.pipe(res);

    await renderStudentsGrid(doc, students, logoBuf, principalBuf);

    const totalPages = Math.ceil(students.length / ROWS_PER_PAGE);
    drawPageFooter(doc, `Class ${cls} — ${students.length} students — ${totalPages} page(s) • ${ROWS_PER_PAGE} cards/sheet`);

    doc.end();
  } catch (err) {
    console.error("❌ Bulk ID Card PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
