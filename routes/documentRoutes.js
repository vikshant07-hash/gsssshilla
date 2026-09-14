const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");

const { db } = require("../config/db");

// ✅ Callback → Promise wrapper (existing mysql2 ke saath kaam karega)
const q = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

// ============================================================
// TABLE AUTO-CREATE (Server file me kuch nahi karna)
// ============================================================
(async () => {
    try {
        await q(`
            CREATE TABLE IF NOT EXISTS school_documents (
                id INT PRIMARY KEY AUTO_INCREMENT,
                doc_number VARCHAR(100) NOT NULL,
                doc_date DATE NOT NULL,
                doc_type VARCHAR(80) NOT NULL,
                title VARCHAR(255) NOT NULL,
                subject VARCHAR(500),
                body_html LONGTEXT NOT NULL,
                issued_by_name VARCHAR(150),
                issued_by_designation VARCHAR(150),
                status ENUM('Draft','Published','Archived') DEFAULT 'Draft',
                created_by VARCHAR(120),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_doc_number (doc_number),
                INDEX idx_doc_date (doc_date DESC),
                INDEX idx_type (doc_type),
                INDEX idx_status (status),
                INDEX idx_created (created_at DESC)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log("✅ school_documents table ready");
    } catch (err) {
        console.error("❌ school_documents table error:", err.message);
    }
})();

// ============================================================
// HELPERS
// ============================================================
const BODY_FIELDS = [
    "docNumber", "docDate", "docType", "title",
    "subject", "bodyHtml", "issuedByName", "issuedByDesignation", "status"
];

const toSnake = (s) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());

const pickBody = (b) => {
    const out = {};
    for (const k of BODY_FIELDS) {
        if (b[k] !== undefined && b[k] !== null) out[toSnake(k)] = b[k];
    }
    return out;
};

const esc = (v) => v === null || v === undefined ? "" : String(v);

function fmtDateIN(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d)) return String(dateStr);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ============================================================
// HTML → Plain blocks (PDF ke liye)
// ============================================================
function htmlToBlocks(html) {
    if (!html) return [];
    let s = String(html);
    s = s.replace(/<\s*br\s*\/?>/gi, "\n");
    s = s.replace(/<\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, "\n");
    s = s.replace(/<\s*li[^>]*>/gi, "• ");
    s = s.replace(/<\s*(h1|h2|h3|h4|h5|h6)[^>]*>/gi, "\n## ");
    s = s.replace(/<[^>]+>/g, "");
    s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
         .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
         .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return s.split(/\n+/).map(l => l.trim()).filter(Boolean);
}

// ============================================================
// IMAGE FETCH
// ============================================================
function fetchImageBuffer(url, redirects = 0) {
    return new Promise((resolve) => {
        if (!url || redirects > 5) return resolve(null);
        try { new URL(url); } catch { return resolve(null); }
        const client = url.startsWith("https") ? https : http;
        const req = client.get(url, (resp) => {
            if ([301, 302, 307, 308].includes(resp.statusCode) && resp.headers.location) {
                resp.resume();
                return resolve(fetchImageBuffer(resp.headers.location, redirects + 1));
            }
            if (resp.statusCode !== 200) { resp.resume(); return resolve(null); }
            const ct = resp.headers["content-type"] || "";
            if (!ct.startsWith("image/")) { resp.resume(); return resolve(null); }
            const chunks = [];
            let size = 0;
            resp.on("data", (c) => {
                size += c.length;
                if (size > 5 * 1024 * 1024) { req.destroy(); return resolve(null); }
                chunks.push(c);
            });
            resp.on("end", () => resolve(Buffer.concat(chunks)));
        });
        req.on("error", () => resolve(null));
        req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    });
}

// ============================================================
// SCHOOL CONFIG
// ============================================================
const SCHOOL = {
    name: "GOVT. SR. SEC. SCHOOL SHILLA",
    address: "Shilla, Teh. Nerwa, Distt. Shimla, Himachal Pradesh — 171210",
    logoUrl: "https://gsssshilla07.pages.dev/logo(1).png",
    principalSignatureUrl: "https://gsssshilla07.pages.dev/principal.png"
};

// ============================================================
// LIST / SEARCH
// ============================================================
router.get("/", async (req, res) => {
    try {
        const {
            search = "", type = "", status = "",
            sortBy = "created_at", order = "desc",
            page = 1, limit = 20
        } = req.query;

        const allowedSort = ["created_at", "updated_at", "doc_date", "doc_number", "title", "doc_type"];
        const sortCol = allowedSort.includes(sortBy) ? sortBy : "created_at";
        const sortDir = order.toLowerCase() === "asc" ? "ASC" : "DESC";

        const where = [];
        const params = [];

        if (type) { where.push("doc_type = ?"); params.push(type); }
        if (status) { where.push("status = ?"); params.push(status); }
        if (search) {
            where.push("(title LIKE ? OR doc_number LIKE ? OR subject LIKE ? OR issued_by_name LIKE ?)");
            const like = `%${search}%`;
            params.push(like, like, like, like);
        }

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const offset = (Number(page) - 1) * Number(limit);

        const rows = await q(
            `SELECT id, doc_number, doc_date, doc_type, title, subject,
                    issued_by_name, issued_by_designation, status,
                    created_by, created_at, updated_at
             FROM school_documents ${whereSql}
             ORDER BY ${sortCol} ${sortDir}
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), offset]
        );

        const countRows = await q(`SELECT COUNT(*) AS total FROM school_documents ${whereSql}`, params);
        const total = countRows[0]?.total || 0;

        // Type counts
        const typeCounts = await q(
            `SELECT doc_type, COUNT(*) AS count FROM school_documents GROUP BY doc_type`
        );

        res.json({
            success: true,
            data: rows,
            typeCounts,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error("❌ List documents error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// STATS
// ============================================================
router.get("/stats", async (req, res) => {
    try {
        const [total] = await q("SELECT COUNT(*) AS c FROM school_documents");
        const [published] = await q("SELECT COUNT(*) AS c FROM school_documents WHERE status='Published'");
        const [drafts] = await q("SELECT COUNT(*) AS c FROM school_documents WHERE status='Draft'");
        const [thisMonth] = await q("SELECT COUNT(*) AS c FROM school_documents WHERE MONTH(doc_date)=MONTH(NOW()) AND YEAR(doc_date)=YEAR(NOW())");
        res.json({
            success: true,
            data: {
                total: total[0]?.c || 0,
                published: published[0]?.c || 0,
                drafts: drafts[0]?.c || 0,
                thisMonth: thisMonth[0]?.c || 0
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// GET SINGLE
// ============================================================
router.get("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Document not found" });
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// CREATE
// ============================================================
router.post("/", async (req, res) => {
    try {
        const data = pickBody(req.body);

        // Validation
        if (!data.doc_number) return res.status(400).json({ success: false, message: "Document number is required" });
        if (!data.doc_date) return res.status(400).json({ success: false, message: "Document date is required" });
        if (!data.doc_type) return res.status(400).json({ success: false, message: "Document type is required" });
        if (!data.title) return res.status(400).json({ success: false, message: "Title is required" });
        if (!data.body_html) return res.status(400).json({ success: false, message: "Body content is required" });

        if (!data.status) data.status = "Draft";

        // Created by from JWT
        if (req.admin) {
            data.created_by = req.admin.username || req.admin.name || "admin";
        }

        const cols = Object.keys(data);
        const vals = Object.values(data);
        const ph = cols.map(() => "?").join(",");

        const result = await q(
            `INSERT INTO school_documents (${cols.join(",")}) VALUES (${ph})`,
            vals
        );

        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [result.insertId]);
        res.status(201).json({
            success: true,
            message: "Document created successfully ✅",
            data: rows[0]
        });
    } catch (err) {
        console.error("❌ Create document error:", err);
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(400).json({ success: false, message: "Document number already exists" });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// UPDATE
// ============================================================
router.put("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

        const existing = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        if (!existing.length) return res.status(404).json({ success: false, message: "Document not found" });

        const data = pickBody(req.body);
        const cols = Object.keys(data);
        if (!cols.length) {
            return res.json({ success: true, message: "No changes", data: existing[0] });
        }

        const setSql = cols.map(c => `${c} = ?`).join(", ");
        await q(`UPDATE school_documents SET ${setSql} WHERE id = ?`, [...Object.values(data), id]);

        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        res.json({
            success: true,
            message: "Document updated successfully ✅",
            data: rows[0]
        });
    } catch (err) {
        console.error("❌ Update document error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// DELETE
// ============================================================
router.delete("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

        const rows = await q("SELECT id FROM school_documents WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Document not found" });

        await q("DELETE FROM school_documents WHERE id = ?", [id]);
        res.json({ success: true, message: "Document deleted successfully ✅" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// DUPLICATE
// ============================================================
router.post("/:id/duplicate", async (req, res) => {
    try {
        const id = req.params.id;
        if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Document not found" });

        const src = rows[0];
        const newNumber = (src.doc_number || "DOC") + "-COPY-" + Date.now().toString().slice(-4);
        const newTitle = "Copy of " + src.title;

        const result = await q(
            `INSERT INTO school_documents 
             (doc_number, doc_date, doc_type, title, subject, body_html, 
              issued_by_name, issued_by_designation, status, created_by)
             VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, 'Draft', ?)`,
            [
                newNumber, src.doc_type, newTitle, src.subject, src.body_html,
                src.issued_by_name, src.issued_by_designation,
                req.admin?.username || "admin"
            ]
        );

        const newRows = await q("SELECT * FROM school_documents WHERE id = ?", [result.insertId]);
        res.status(201).json({
            success: true,
            message: "Document duplicated ✅",
            data: newRows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// NEXT DOC NUMBER (Auto-generate helper)
// ============================================================
router.get("/next-number/:type", async (req, res) => {
    try {
        const type = req.params.type.toUpperCase().replace(/\s+/g, "");
        const year = new Date().getFullYear();
        const prefix = `GSSS/${year}/${type}/`;

        const rows = await q(
            `SELECT doc_number FROM school_documents 
             WHERE doc_number LIKE ? 
             ORDER BY id DESC LIMIT 1`,
            [`${prefix}%`]
        );

        let next = 1;
        if (rows.length) {
            const last = rows[0].doc_number;
            const parts = last.split("/");
            const num = parseInt(parts[parts.length - 1]);
            if (!isNaN(num)) next = num + 1;
        }

        const number = prefix + String(next).padStart(3, "0");
        res.json({ success: true, docNumber: number });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// PDF GENERATION (A4 with school letterhead)
// ============================================================
router.get("/:id/pdf", async (req, res) => {
    try {
        const id = req.params.id;
        if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Document not found" });

        const d = rows[0];

        // Fetch images (parallel)
        const [logoBuf, principalSigBuf] = await Promise.all([
            fetchImageBuffer(SCHOOL.logoUrl),
            fetchImageBuffer(SCHOOL.principalSignatureUrl)
        ]);

        // A4 with margins
        const doc = new PDFDocument({
            size: "A4",
            margins: { top: 45, bottom: 45, left: 50, right: 50 },
            info: {
                Title: d.title || "School Document",
                Author: SCHOOL.name,
                Subject: d.subject || ""
            }
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            `inline; filename="${(d.doc_number || "document").replace(/\//g, "-")}.pdf"`
        );
        doc.pipe(res);

        const pageW = doc.page.width;
        const pageH = doc.page.height;
        const ML = 50; // margin left
        const MR = 50;
        const contentW = pageW - ML - MR;

        // ============================================================
        // WATERMARK (school name, very light)
        // ============================================================
        doc.save();
        doc.opacity(0.045);
        doc.font("Helvetica-Bold").fontSize(80).fillColor("#c9972b");
        doc.translate(pageW / 2, pageH / 2);
        doc.rotate(-25, { origin: [0, 0] });
        doc.text("GSSS SHILLA", -260, -30, { width: 520, align: "center" });
        doc.restore();

        // ============================================================
        // LETTERHEAD
        // ============================================================
        const headerY = 40;
        const headerH = 110;

        // Logo circle
        if (logoBuf) {
            try {
                doc.save();
                doc.circle(ML + 35, headerY + 35, 37).fill("#ffffff");
                doc.circle(ML + 35, headerY + 35, 35).lineWidth(1.5).strokeColor("#c9972b").stroke();
                doc.restore();
                doc.image(logoBuf, ML + 5, headerY + 5, {
                    fit: [60, 60],
                    align: "center",
                    valign: "center"
                });
            } catch (e) { /* skip */ }
        }

        // School name
        doc.font("Helvetica-Bold").fontSize(21).fillColor("#0d1b2a")
           .text(SCHOOL.name, ML + 85, headerY + 8, {
               width: contentW - 85,
               align: "center"
           });

        // Tagline
        doc.font("Helvetica").fontSize(9).fillColor("#5a6a7e")
           .text(SCHOOL.address, ML + 85, headerY + 38, {
               width: contentW - 85,
               align: "center",
               characterSpacing: 0.6
           });

        // Gold divider
        const dividerY = headerY + headerH;
        doc.moveTo(ML, dividerY).lineTo(pageW - MR, dividerY)
           .lineWidth(3).strokeColor("#c9972b").stroke();
        doc.moveTo(ML, dividerY + 4).lineTo(pageW - MR, dividerY + 4)
           .lineWidth(0.6).strokeColor("#0d1b2a").stroke();

        // ============================================================
        // META: No. (left) + Date (right)
        // ============================================================
        let y = dividerY + 18;

        doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0d1b2a");
        doc.text(`No: ${esc(d.doc_number)}`, ML, y);

        doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0d1b2a");
        doc.text(`Date: ${fmtDateIN(d.doc_date)}`, ML, y, {
            width: contentW,
            align: "right"
        });

        // ============================================================
        // TYPE BADGE (centered)
        // ============================================================
        y += 26;
        const typeText = String(d.doc_type || "NOTICE").toUpperCase();
        doc.font("Helvetica-Bold").fontSize(13);
        const typeW = doc.widthOfString(typeText) + 60;
        const badgeX = (pageW - typeW) / 2;

        doc.roundedRect(badgeX, y, typeW, 26, 13)
           .fillAndStroke("#0d1b2a", "#c9972b");
        doc.lineWidth(1.6);
        doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff")
           .text(typeText, badgeX, y + 6.5, {
               width: typeW,
               align: "center",
               characterSpacing: 2.5
           });

        y += 40;

        // ============================================================
        // SUBJECT
        // ============================================================
        if (d.subject) {
            doc.font("Helvetica-Bold").fontSize(11.5).fillColor("#0d1b2a")
               .text("Subject: ", ML, y, { continued: true });
            doc.font("Helvetica").fontSize(11.5).fillColor("#1a2332")
               .text(esc(d.subject), { width: contentW });
            y = doc.y + 6;
            doc.moveTo(ML, y).lineTo(pageW - MR, y)
               .lineWidth(0.8).strokeColor("#0d1b2a").stroke();
            y += 12;
        }

        // ============================================================
        // BODY
        // ============================================================
        const bodyBlocks = htmlToBlocks(d.body_html);
        doc.font("Helvetica").fontSize(11.5).fillColor("#1a2332");

        const lineGap = 4.5;
        const paraGap = 8;
        const bottomLimit = pageH - 130; // leave space for signature

        for (const block of bodyBlocks) {
            const isHeading = block.startsWith("## ");
            const text = isHeading ? block.slice(3) : block;

            doc.font(isHeading ? "Helvetica-Bold" : "Helvetica")
               .fontSize(isHeading ? 13 : 11.5)
               .fillColor(isHeading ? "#0d1b2a" : "#1a2332");

            const h = doc.heightOfString(text, {
                width: contentW,
                lineGap
            });

            if (y + h > bottomLimit) {
                doc.addPage();
                // repeat watermark on new page
                doc.save();
                doc.opacity(0.045);
                doc.font("Helvetica-Bold").fontSize(80).fillColor("#c9972b");
                doc.translate(pageW / 2, pageH / 2);
                doc.rotate(-25, { origin: [0, 0] });
                doc.text("GSSS SHILLA", -260, -30, { width: 520, align: "center" });
                doc.restore();
                y = 60;
            }

            doc.text(text, ML, y, {
                width: contentW,
                align: isHeading ? "left" : "justify",
                lineGap
            });

            y = doc.y + (isHeading ? 8 : paraGap);
        }

        // ============================================================
        // SIGNATURE AREA
        // ============================================================
        const signY = pageH - 115;

        // If body ended near bottom, force new page for signature
        if (y > signY - 40) {
            doc.addPage();
            // watermark again
            doc.save();
            doc.opacity(0.045);
            doc.font("Helvetica-Bold").fontSize(80).fillColor("#c9972b");
            doc.translate(pageW / 2, pageH / 2);
            doc.rotate(-25, { origin: [0, 0] });
            doc.text("GSSS SHILLA", -260, -30, { width: 520, align: "center" });
            doc.restore();
        }

        const signBlockW = 200;
        const signBlockX = pageW - MR - signBlockW;

        if (principalSigBuf) {
            try {
                doc.image(principalSigBuf, signBlockX + 50, signY - 55, {
                    fit: [100, 50],
                    align: "center"
                });
            } catch (e) { /* skip */ }
        }

        // Signature dashed line
        doc.moveTo(signBlockX + 10, signY).lineTo(signBlockX + signBlockW - 10, signY)
           .lineWidth(0.8).strokeColor("#64748b").dash(3, { space: 3 }).stroke();
        doc.undash();

        // Name + designation
        doc.font("Helvetica-Bold").fontSize(12).fillColor("#0d1b2a")
           .text(esc(d.issued_by_name || "Principal"), signBlockX, signY + 8, {
               width: signBlockW,
               align: "center"
           });

        doc.font("Helvetica").fontSize(10).fillColor("#475569")
           .text(esc(d.issued_by_designation || SCHOOL.name), signBlockX, signY + 24, {
               width: signBlockW,
               align: "center"
           });

        // ============================================================
        // FOOTER
        // ============================================================
        doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8")
           .text(
               `OFFICIAL DOCUMENT · ${SCHOOL.name} · SHIMLA (HP)`,
               ML,
               pageH - 30,
               { width: contentW, align: "center", characterSpacing: 1 }
           );

        doc.end();
    } catch (err) {
        console.error("❌ PDF generation error:", err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: "PDF generation failed" });
        }
    }
});

module.exports = router;
