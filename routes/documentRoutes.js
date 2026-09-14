const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");
const multer = require("multer");
const { cloudinary } = require("../config/cloudinary");

const { db } = require("../config/db");

// ✅ Wrapper for callback-based mysql2
const q = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

// ============================================================
// TABLE AUTO-CREATE + AUTO-MIGRATION
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
                title_style TEXT DEFAULT NULL,
                subject VARCHAR(500),
                subject_style TEXT DEFAULT NULL,
                body_html LONGTEXT NOT NULL,
                issued_by_name VARCHAR(150),
                issued_by_designation VARCHAR(150),
                signature_url VARCHAR(500) DEFAULT NULL,
                signature_public_id VARCHAR(255) DEFAULT NULL,
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

        // Auto-migration
        const existingCols = await q("SHOW COLUMNS FROM school_documents");
        const colNames = existingCols.map(c => c.Field);

        const requiredCols = [
            { name: "title_style", def: "TEXT DEFAULT NULL", after: "title" },
            { name: "subject_style", def: "TEXT DEFAULT NULL", after: "subject" },
            { name: "signature_url", def: "VARCHAR(500) DEFAULT NULL", after: "issued_by_designation" },
            { name: "signature_public_id", def: "VARCHAR(255) DEFAULT NULL", after: "signature_url" }
        ];

        for (const col of requiredCols) {
            if (!colNames.includes(col.name)) {
                console.log(`📌 Adding missing column: ${col.name}`);
                try {
                    await q(`ALTER TABLE school_documents ADD COLUMN ${col.name} ${col.def} AFTER ${col.after}`);
                    console.log(`✅ Column added: ${col.name}`);
                } catch (alterErr) {
                    await q(`ALTER TABLE school_documents ADD COLUMN ${col.name} ${col.def}`);
                    console.log(`✅ Column added (fallback): ${col.name}`);
                }
            }
        }
        console.log("✅ school_documents schema is up to date");
    } catch (err) {
        console.error("❌ school_documents setup error:", err.message);
    }
})();

// ============================================================
// MULTER — In-Memory for Cloudinary stream
// ============================================================
const uploadDocumentImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ============================================================
// IMAGE UPLOAD (Inline editor images)
// ============================================================
router.post("/upload-image", uploadDocumentImage.single("image"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: "school/documents/inline", resource_type: "image" },
                (err, result) => err ? reject(err) : resolve(result)
            );
            stream.end(req.file.buffer);
        });

        res.json({ success: true, url: result.secure_url, public_id: result.public_id });
    } catch (err) {
        console.error("❌ Image upload error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// SIGNATURE UPLOAD
// ============================================================
router.post("/upload-signature", uploadDocumentImage.single("signature"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

        if (!req.file.mimetype.startsWith("image/")) {
            return res.status(400).json({ success: false, message: "Only image files allowed" });
        }
        if (req.file.size > 3 * 1024 * 1024) {
            return res.status(400).json({ success: false, message: "Max 3 MB allowed" });
        }

        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: "school/documents/signatures", resource_type: "image" },
                (err, result) => err ? reject(err) : resolve(result)
            );
            stream.end(req.file.buffer);
        });

        res.json({ success: true, url: result.secure_url, public_id: result.public_id });
    } catch (err) {
        console.error("❌ Signature upload error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// HELPERS
// ============================================================
const BODY_FIELDS = [
    "docNumber", "docDate", "docType", "title", "titleStyle",
    "subject", "subjectStyle", "bodyHtml",
    "issuedByName", "issuedByDesignation",
    "signatureUrl", "signaturePublicId", "status"
];

const toSnake = (s) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());

const pickBody = (b) => {
    const out = {};
    for (const k of BODY_FIELDS) {
        if (b[k] !== undefined && b[k] !== null) out[toSnake(k)] = b[k];
    }
    return out;
};

function fmtDateIN(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d)) return String(dateStr);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

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
// HTML → RICH BLOCKS (para, heading, list, table, image, bold, etc.)
// ============================================================
function parseHtmlToBlocks(html) {
    if (!html) return [];
    const blocks = [];
    let s = String(html).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");

    // Insert markers for images and horizontal rules inline
    const blockRegex = /<(h[1-6]|p|div|ul|ol|table|blockquote|pre)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;
    const matchedRanges = [];

    while ((match = blockRegex.exec(s)) !== null) {
        matchedRanges.push({
            start: match.index,
            end: match.index + match[0].length,
            tag: match[1].toLowerCase(),
            content: match[2],
            full: match[0]
        });
    }

    if (matchedRanges.length === 0) {
        const text = stripHtml(s);
        if (text.trim()) blocks.push({ type: "p", text });
        return blocks;
    }

    for (const m of matchedRanges) {
        if (m.tag.startsWith("h") && m.tag.length === 2) {
            const level = parseInt(m.tag[1]);
            const text = stripHtml(m.content).trim();
            if (text) blocks.push({ type: "heading", level, text });
        } else if (m.tag === "p" || m.tag === "div") {
            // Check if this block contains an image
            const imgInBlock = m.content.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
            if (imgInBlock) {
                blocks.push({ type: "image", src: imgInBlock[1] });
            }
            // Also extract text
            const text = stripHtml(m.content).trim();
            if (text) blocks.push({ type: "p", text });
        } else if (m.tag === "ul" || m.tag === "ol") {
            const items = [];
            const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
            let li;
            while ((li = liRegex.exec(m.content)) !== null) {
                const text = stripHtml(li[1]).trim();
                if (text) items.push(text);
            }
            if (items.length) blocks.push({ type: "list", ordered: m.tag === "ol", items });
        } else if (m.tag === "blockquote") {
            const text = stripHtml(m.content).trim();
            if (text) blocks.push({ type: "quote", text });
        } else if (m.tag === "table") {
            const rows = [];
            const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            let tr;
            while ((tr = trRegex.exec(m.content)) !== null) {
                const cells = [];
                const cellRegex = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
                let cell;
                while ((cell = cellRegex.exec(tr[1])) !== null) {
                    cells.push({ text: stripHtml(cell[2]).trim(), isHeader: cell[1].toLowerCase() === "th" });
                }
                if (cells.length) rows.push(cells);
            }
            if (rows.length) blocks.push({ type: "table", rows });
        } else if (m.tag === "pre") {
            const text = stripHtml(m.content);
            if (text.trim()) blocks.push({ type: "code", text });
        }
    }

    // Standalone images (outside blocks)
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let imgMatch;
    const foundImgs = new Set();
    while ((imgMatch = imgRegex.exec(s)) !== null) {
        const src = imgMatch[1];
        if (!blocks.some(b => b.type === "image" && b.src === src) && !foundImgs.has(src)) {
            blocks.push({ type: "image", src });
            foundImgs.add(src);
        }
    }

    return blocks;
}

function stripHtml(html) {
    return String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&rdquo;/g, '"')
        .replace(/&ldquo;/g, '"')
        .trim();
}

// ============================================================
// SCHOOL CONFIG
// ============================================================
const SCHOOL = {
    name: "GOVT. SR. SEC. SCHOOL SHILLA",
    address: "Shilla, Teh. Nerwa, Distt. Shimla, Himachal Pradesh — 171210",
    logoUrl: "https://gsssshilla07.pages.dev/logo(1).png"
};

// ============================================================
// LIST
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
            `SELECT id, doc_number, doc_date, doc_type, title, subject, issued_by_name, issued_by_designation, status, signature_url, created_by, created_at, updated_at
             FROM school_documents ${whereSql}
             ORDER BY ${sortCol} ${sortDir}
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), offset]
        );

        const countRows = await q(`SELECT COUNT(*) AS total FROM school_documents ${whereSql}`, params);
        const total = countRows[0]?.total || 0;

        const typeCounts = await q(`SELECT doc_type, COUNT(*) AS count FROM school_documents GROUP BY doc_type`);

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
        console.error("❌ List error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// STATS
// ============================================================
router.get("/stats", async (req, res) => {
    try {
        const total = await q("SELECT COUNT(*) AS c FROM school_documents");
        const published = await q("SELECT COUNT(*) AS c FROM school_documents WHERE status='Published'");
        const drafts = await q("SELECT COUNT(*) AS c FROM school_documents WHERE status='Draft'");
        const thisMonth = await q("SELECT COUNT(*) AS c FROM school_documents WHERE MONTH(doc_date)=MONTH(NOW()) AND YEAR(doc_date)=YEAR(NOW())");

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
// NEXT DOC NUMBER
// ============================================================
router.get("/next-number/:type", async (req, res) => {
    try {
        const type = req.params.type.toUpperCase().replace(/\s+/g, "");
        const year = new Date().getFullYear();
        const prefix = `GSSS/${year}/${type}/`;

        const rows = await q(
            `SELECT doc_number FROM school_documents WHERE doc_number LIKE ? ORDER BY id DESC LIMIT 1`,
            [`${prefix}%`]
        );

        let next = 1;
        if (rows.length) {
            const parts = rows[0].doc_number.split("/");
            const num = parseInt(parts[parts.length - 1]);
            if (!isNaN(num)) next = num + 1;
        }

        res.json({ success: true, docNumber: prefix + String(next).padStart(3, "0") });
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
        if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });
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
        if (!data.doc_number) return res.status(400).json({ success: false, message: "Document number required" });
        if (!data.doc_date) return res.status(400).json({ success: false, message: "Date required" });
        if (!data.doc_type) return res.status(400).json({ success: false, message: "Type required" });
        if (!data.title) return res.status(400).json({ success: false, message: "Title required" });
        if (!data.body_html) return res.status(400).json({ success: false, message: "Body required" });
        if (!data.status) data.status = "Draft";
        if (req.admin) data.created_by = req.admin.username || req.admin.name || "admin";

        const cols = Object.keys(data);
        const vals = Object.values(data);
        const ph = cols.map(() => "?").join(",");

        const result = await q(`INSERT INTO school_documents (${cols.join(",")}) VALUES (${ph})`, vals);
        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [result.insertId]);
        res.status(201).json({ success: true, message: "Document created ✅", data: rows[0] });
    } catch (err) {
        console.error("❌ Create error:", err);
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
        if (!existing.length) return res.status(404).json({ success: false, message: "Not found" });

        const data = pickBody(req.body);
        const cols = Object.keys(data);
        if (!cols.length) return res.json({ success: true, message: "No changes", data: existing[0] });

        const setSql = cols.map(c => `${c} = ?`).join(", ");
        await q(`UPDATE school_documents SET ${setSql} WHERE id = ?`, [...Object.values(data), id]);

        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        res.json({ success: true, message: "Updated ✅", data: rows[0] });
    } catch (err) {
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

        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

        if (rows[0].signature_public_id) {
            try { await cloudinary.uploader.destroy(rows[0].signature_public_id); } catch (e) {}
        }

        await q("DELETE FROM school_documents WHERE id = ?", [id]);
        res.json({ success: true, message: "Deleted ✅" });
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
        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

        const src = rows[0];
        const newNumber = (src.doc_number || "DOC") + "-C" + Date.now().toString().slice(-4);

        const result = await q(
            `INSERT INTO school_documents 
             (doc_number, doc_date, doc_type, title, title_style, subject, subject_style, body_html, 
              issued_by_name, issued_by_designation, signature_url, signature_public_id, status, created_by)
             VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?)`,
            [
                newNumber, src.doc_type, "Copy of " + src.title, src.title_style,
                src.subject, src.subject_style, src.body_html,
                src.issued_by_name, src.issued_by_designation,
                src.signature_url, src.signature_public_id,
                req.admin?.username || "admin"
            ]
        );

        const newRows = await q("SELECT * FROM school_documents WHERE id = ?", [result.insertId]);
        res.status(201).json({ success: true, message: "Duplicated ✅", data: newRows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// PDF GENERATION — Professional A4 Document
// Multi-color watermark · Logo watermark · Proper pagination
// Images · Tables · Rich text
// ============================================================
router.get("/:id/pdf", async (req, res) => {
    try {
        const id = req.params.id;
        if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

        const rows = await q("SELECT * FROM school_documents WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });
        const d = rows[0];

        const [logoBuf, signatureBuf] = await Promise.all([
            fetchImageBuffer(SCHOOL.logoUrl),
            fetchImageBuffer(d.signature_url)
        ]);

        const doc = new PDFDocument({
            size: "A4",
            margins: { top: 32, bottom: 32, left: 40, right: 40 },
            bufferPages: true,
            info: {
                Title: d.title,
                Author: SCHOOL.name,
                Subject: d.subject || "",
                Creator: "GSSS Shilla Document System"
            }
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${(d.doc_number || "document").replace(/\//g, "-")}.pdf"`);
        doc.pipe(res);

        const pageW = doc.page.width;
        const pageH = doc.page.height;
        const ML = 40;
        const MR = 40;
        const MT = 32;
        const MB = 32;
        const contentW = pageW - ML - MR;

        const SIG_RESERVE = 105;
        const FOOTER_RESERVE = 38;

        // ============================================================
        // ✅ COLORFUL WATERMARK (multi-color patterns + logo)
        // ============================================================
        function drawWatermark(pageNum) {
            doc.save();

            // 1) Colorful diagonal cross pattern (multi-color soft)
            const colors = ["#c9972b", "#4a8af4", "#10b981", "#ec4899", "#8b5cf6"];
            doc.opacity(0.018);
            doc.lineWidth(0.9);
            let colorIdx = 0;
            for (let i = -pageH; i < pageW + pageH; i += 42) {
                doc.strokeColor(colors[colorIdx % colors.length]);
                doc.moveTo(i, 0).lineTo(i + pageH, pageH).stroke();
                colorIdx++;
            }

            // 2) Horizontal soft stripes
            doc.opacity(0.012);
            doc.strokeColor("#c9972b");
            doc.lineWidth(0.6);
            for (let y = 0; y < pageH; y += 28) {
                doc.moveTo(0, y).lineTo(pageW, y).stroke();
            }

            // 3) Rotated faint text watermark (school name)
            doc.opacity(0.028);
            doc.save();
            doc.translate(pageW / 2, pageH / 2);
            doc.rotate(-30, { origin: [0, 0] });
            doc.font("Helvetica-Bold").fontSize(66).fillColor("#0d1b2a");
            doc.text("GSSS SHILLA", -280, -30, { width: 560, align: "center" });
            doc.text("OFFICIAL", -280, 40, { width: 560, align: "center", characterSpacing: 8 });
            doc.restore();

            // 4) Center logo watermark (soft)
            if (logoBuf) {
                try {
                    doc.save();
                    doc.opacity(0.055);
                    const wmSize = 260;
                    doc.image(logoBuf, (pageW - wmSize) / 2, (pageH - wmSize) / 2, {
                        width: wmSize,
                        height: wmSize
                    });
                    doc.restore();
                } catch (e) {}
            }

            // 5) Corner decorative gold corners
            doc.opacity(0.20);
            doc.strokeColor("#c9972b").lineWidth(1.2);
            const cLen = 22;
            const cPd = 12;
            // top-left
            doc.moveTo(cPd, cPd).lineTo(cPd + cLen, cPd).stroke();
            doc.moveTo(cPd, cPd).lineTo(cPd, cPd + cLen).stroke();
            // top-right
            doc.moveTo(pageW - cPd, cPd).lineTo(pageW - cPd - cLen, cPd).stroke();
            doc.moveTo(pageW - cPd, cPd).lineTo(pageW - cPd, cPd + cLen).stroke();
            // bottom-left
            doc.moveTo(cPd, pageH - cPd).lineTo(cPd + cLen, pageH - cPd).stroke();
            doc.moveTo(cPd, pageH - cPd).lineTo(cPd, pageH - cPd - cLen).stroke();
            // bottom-right
            doc.moveTo(pageW - cPd, pageH - cPd).lineTo(pageW - cPd - cLen, pageH - cPd).stroke();
            doc.moveTo(pageW - cPd, pageH - cPd).lineTo(pageW - cPd, pageH - cPd - cLen).stroke();

            // 6) Security code strip (bottom)
            doc.opacity(0.11);
            doc.font("Helvetica").fontSize(6).fillColor("#0d1b2a");
            const code = `GSSS-${(d.id || "").toString().padStart(4, "0")}-${new Date().getFullYear()}`;
            doc.text(code, ML, pageH - 16, { width: contentW, align: "left" });
            doc.text(`SECURED · PAGE ${pageNum}`, ML, pageH - 16, { width: contentW, align: "right" });

            doc.opacity(1);
            doc.restore();
        }

        // ============================================================
        // HEADER — Official Letterhead
        // ============================================================
        function drawHeader() {
            const headerY = MT;
            const headerH = 84;
            const logoSize = 64;

            // Logo circle
            if (logoBuf) {
                try {
                    doc.save();
                    doc.circle(ML + logoSize / 2, headerY + logoSize / 2, logoSize / 2 + 1.5).fill("#ffffff");
                    doc.circle(ML + logoSize / 2, headerY + logoSize / 2, logoSize / 2 + 1).lineWidth(1.2).strokeColor("#c9972b").stroke();
                    doc.restore();
                    doc.image(logoBuf, ML + 3, headerY + 3, {
                        fit: [logoSize - 6, logoSize - 6],
                        align: "center",
                        valign: "center"
                    });
                } catch (e) {}
            }

            doc.font("Helvetica-Bold").fontSize(17).fillColor("#0d1b2a")
               .text(SCHOOL.name, ML + logoSize + 12, headerY + 2, {
                   width: contentW - logoSize - 12,
                   align: "center",
                   characterSpacing: 0.6
               });

            doc.font("Helvetica").fontSize(8).fillColor("#5a6a7e")
               .text(SCHOOL.address, ML + logoSize + 12, headerY + 26, {
                   width: contentW - logoSize - 12,
                   align: "center",
                   characterSpacing: 0.4
               });

            doc.font("Helvetica").fontSize(7).fillColor("#94a3b8")
               .text("Affiliated to HPBOSE · Recognized by Govt. of Himachal Pradesh",
                   ML + logoSize + 12, headerY + 40, {
                       width: contentW - logoSize - 12,
                       align: "center",
                       characterSpacing: 0.2
                   });

            const divY = headerY + headerH;
            doc.moveTo(ML, divY).lineTo(pageW - MR, divY).lineWidth(2.5).strokeColor("#c9972b").stroke();
            doc.moveTo(ML, divY + 3).lineTo(pageW - MR, divY + 3).lineWidth(0.4).strokeColor("#0d1b2a").stroke();

            return divY + 8;
        }

        // ============================================================
        // META — Ref. No / Date / Type badge
        // ============================================================
        function drawMeta(y) {
            doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0d1b2a");
            doc.text(`Ref. No: ${d.doc_number || "-"}`, ML, y);
            doc.text(`Date: ${fmtDateIN(d.doc_date)}`, ML, y, { width: contentW, align: "right" });

            y += 18;

            const typeText = String(d.doc_type || "DOCUMENT").toUpperCase();
            doc.font("Helvetica-Bold").fontSize(10.5);
            const typeTextW = doc.widthOfString(typeText);
            const badgeW = typeTextW + 44;
            const badgeH = 20;
            const badgeX = (pageW - badgeW) / 2;

            doc.roundedRect(badgeX, y, badgeW, badgeH, 10).fillColor("#0d1b2a").fill();
            doc.roundedRect(badgeX, y, badgeW, badgeH, 10).lineWidth(1.2).strokeColor("#c9972b").stroke();

            doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#ffffff")
               .text(typeText, badgeX, y + 5, {
                   width: badgeW,
                   align: "center",
                   characterSpacing: 2.5
               });

            return y + badgeH + 10;
        }

        // ============================================================
        // TITLE
        // ============================================================
        function drawTitle(y) {
            if (!d.title) return y;
            doc.font("Helvetica-Bold").fontSize(13).fillColor("#0d1b2a")
               .text(d.title.toUpperCase(), ML, y, {
                   width: contentW,
                   align: "center",
                   characterSpacing: 0.8
               });
            return doc.y + 8;
        }

        // ============================================================
        // SUBJECT
        // ============================================================
        function drawSubject(y) {
            if (!d.subject) return y;
            doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
               .text("Subject: ", ML, y, { continued: true });
            doc.font("Helvetica").fontSize(10).fillColor("#1a2332")
               .text(d.subject, { width: contentW });

            const lineY = doc.y + 4;
            doc.moveTo(ML, lineY).lineTo(pageW - MR, lineY).lineWidth(0.5).strokeColor("#c9972b").stroke();
            return lineY + 8;
        }

        // ============================================================
        // SIGNATURE BLOCK
        // ============================================================
        function drawSignature(forceY) {
            const sigW = 190;
            const sigX = pageW - MR - sigW;

            let y = forceY + 20;

            if (signatureBuf) {
                try {
                    doc.image(signatureBuf, sigX + 40, y - 5, {
                        fit: [110, 55],
                        align: "center"
                    });
                    y += 50;
                } catch (e) { y += 15; }
            } else {
                y += 40;
            }

            doc.moveTo(sigX + 20, y).lineTo(sigX + sigW - 20, y)
               .lineWidth(0.7).strokeColor("#64748b").stroke();

            doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0d1b2a")
               .text(d.issued_by_name || "Principal", sigX, y + 6, { width: sigW, align: "center" });

            doc.font("Helvetica").fontSize(8.5).fillColor("#475569")
               .text(d.issued_by_designation || "Govt. Sr. Sec. School Shilla", sigX, y + 20, { width: sigW, align: "center" });

            return y + 32;
        }

        // ============================================================
        // FOOTER
        // ============================================================
        function drawFooter(pageNum, totalPages) {
            const footerY = pageH - 24;

            doc.save();
            doc.opacity(0.08);
            for (let i = 0; i < pageW; i += 10) {
                doc.rect(i, footerY - 2, 6, 0.4).fill("#c9972b");
            }
            doc.restore();

            doc.moveTo(ML, footerY).lineTo(pageW - MR, footerY).lineWidth(0.5).strokeColor("#c9972b").stroke();

            doc.font("Helvetica").fontSize(6.5).fillColor("#64748b");
            doc.text(`Official Document · ${SCHOOL.name}`, ML, footerY + 4, { width: contentW / 2, align: "left" });

            doc.font("Helvetica").fontSize(6.5).fillColor("#64748b");
            doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, ML, footerY + 4, { width: contentW, align: "center" });

            doc.font("Helvetica-Bold").fontSize(7).fillColor("#0d1b2a");
            doc.text(`Page ${pageNum} of ${totalPages}`, ML, footerY + 4, { width: contentW, align: "right" });
        }

        // ============================================================
        // PAGE 1 SETUP
        // ============================================================
        drawWatermark(1);
        let y = drawHeader();
        y = drawMeta(y);
        y = drawTitle(y);
        y = drawSubject(y);

        const blocks = parseHtmlToBlocks(d.body_html);
        const BODY_BOTTOM = pageH - MB - FOOTER_RESERVE;
        let pageNum = 1;

        function newPage() {
            doc.addPage();
            pageNum++;
            drawWatermark(pageNum);
            y = MT + 15;
        }

        // ============================================================
        // RENDER BODY
        // ============================================================
        for (const block of blocks) {
            if (block.type === "heading") {
                const sizes = { 1: 15, 2: 13, 3: 12, 4: 11.5, 5: 11, 6: 10.5 };
                const fontSize = sizes[block.level] || 12;

                doc.font("Helvetica-Bold").fontSize(fontSize);
                const h = doc.heightOfString(block.text, { width: contentW, lineGap: 2 });

                if (y + h + 10 > BODY_BOTTOM) newPage();

                doc.font("Helvetica-Bold").fontSize(fontSize).fillColor("#0d1b2a")
                   .text(block.text, ML, y, { width: contentW, lineGap: 2 });
                y = doc.y + 6;

            } else if (block.type === "p") {
                doc.font("Helvetica").fontSize(10.5);
                const h = doc.heightOfString(block.text, { width: contentW, lineGap: 3 });

                if (y + h > BODY_BOTTOM) newPage();

                doc.font("Helvetica").fontSize(10.5).fillColor("#1a2332")
                   .text(block.text, ML, y, { width: contentW, lineGap: 3, align: "justify" });
                y = doc.y + 6;

            } else if (block.type === "list") {
                for (let idx = 0; idx < block.items.length; idx++) {
                    const item = block.items[idx];
                    const bullet = block.ordered ? `${idx + 1}.` : "•";

                    doc.font("Helvetica").fontSize(10.5);
                    const h = doc.heightOfString(`${bullet}  ${item}`, { width: contentW - 15, lineGap: 2 });

                    if (y + h > BODY_BOTTOM) newPage();

                    doc.font("Helvetica").fontSize(10.5).fillColor("#1a2332")
                       .text(`${bullet}  ${item}`, ML + 10, y, { width: contentW - 15, lineGap: 2 });
                    y = doc.y + 3;
                }
                y += 4;

            } else if (block.type === "table") {
                const colCount = Math.max(...block.rows.map(r => r.length));
                const colW = contentW / colCount;
                const rowH = 20;

                let tblY = y;
                block.rows.forEach((row) => {
                    const isHeader = row.some(c => c.isHeader);

                    if (tblY + rowH > BODY_BOTTOM) {
                        doc.addPage();
                        pageNum++;
                        drawWatermark(pageNum);
                        tblY = MT + 15;
                    }

                    let cellX = ML;
                    row.forEach((cell, ci) => {
                        if (ci < colCount) {
                            if (isHeader) doc.rect(cellX, tblY, colW, rowH).fillColor("#fef8ed").fill();
                            doc.rect(cellX, tblY, colW, rowH).lineWidth(0.4).strokeColor("#94a3b8").stroke();
                            doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor("#1a2332")
                               .text(cell.text, cellX + 5, tblY + 5, { width: colW - 10, height: rowH - 8, ellipsis: true });
                            cellX += colW;
                        }
                    });
                    tblY += rowH;
                });
                y = tblY + 8;

            } else if (block.type === "quote") {
                doc.font("Helvetica-Oblique").fontSize(10);
                const h = doc.heightOfString(block.text, { width: contentW - 20, lineGap: 2 }) + 12;

                if (y + h > BODY_BOTTOM) newPage();

                doc.rect(ML, y, 3, h - 6).fillColor("#c9972b").fill();
                doc.font("Helvetica-Oblique").fontSize(10).fillColor("#475569")
                   .text(block.text, ML + 12, y + 4, { width: contentW - 20, lineGap: 2 });
                y = doc.y + 8;

            } else if (block.type === "code") {
                doc.font("Courier").fontSize(8.5);
                const h = doc.heightOfString(block.text, { width: contentW - 16, lineGap: 2 }) + 14;

                if (y + h > BODY_BOTTOM) newPage();

                doc.rect(ML, y, contentW, h).fillColor("#f8fafc").fill();
                doc.rect(ML, y, contentW, h).lineWidth(0.4).strokeColor("#e2e8f0").stroke();
                doc.font("Courier").fontSize(8.5).fillColor("#1a2332")
                   .text(block.text, ML + 8, y + 6, { width: contentW - 16, lineGap: 2 });
                y = doc.y + 8;

            } else if (block.type === "image") {
                const imgBuf = await fetchImageBuffer(block.src);
                if (imgBuf) {
                    try {
                        const imgMaxW = contentW;
                        const imgMaxH = 240;
                        const boxY = y + 6;

                        // Calculate image size preserving aspect ratio
                        // PDFKit's fit does this automatically
                        const reservedH = imgMaxH + 12;

                        if (boxY + reservedH > BODY_BOTTOM) {
                            doc.addPage();
                            pageNum++;
                            drawWatermark(pageNum);
                            y = MT + 15;
                        }

                        // Soft frame
                        doc.save();
                        doc.roundedRect(ML, y + 2, contentW, imgMaxH + 8, 4)
                           .lineWidth(0.4).strokeColor("#cbd5e1").stroke();
                        doc.restore();

                        doc.image(imgBuf, ML + 4, y + 6, {
                            fit: [contentW - 8, imgMaxH],
                            align: "center",
                            valign: "center"
                        });
                        y += imgMaxH + 20;
                    } catch (e) {
                        console.log("⚠️ Image render failed:", e.message);
                    }
                }
            }
        }

        // ============================================================
        // SIGNATURE
        // ============================================================
        const sigSpace = pageH - MB - FOOTER_RESERVE;
        if (y + SIG_RESERVE > sigSpace) {
            doc.addPage();
            pageNum++;
            drawWatermark(pageNum);
            y = MT + 20;
        }

        drawSignature(y);

        // ============================================================
        // FOOTERS ON ALL PAGES
        // ============================================================
        const range = doc.bufferedPageRange();
        const totalPages = pageNum;

        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(range.start + i);
            drawFooter(i + 1, totalPages);
        }

        doc.end();
    } catch (err) {
        console.error("❌ PDF error:", err);
        if (!res.headersSent) res.status(500).json({ success: false, message: "PDF failed" });
    }
});

module.exports = router;
