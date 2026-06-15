const db = require("../config/db");

// ADD
exports.add = (req,res)=>{
  const photo = req.file ? req.file.filename : "";

  const sql = `
    INSERT INTO faculty
    (name,type,subject,qualification,experience,previous_school,message,photo)
    VALUES (?,?,?,?,?,?,?,?)
  `;

  db.query(sql,[
    req.body.name,
    req.body.type,
    req.body.subject,
    req.body.qualification,
    req.body.experience,
    req.body.previous_school,
    req.body.message,
    photo
  ],(err)=>{
    res.json({msg:"added"});
  });
};

// UPDATE
exports.update = (req,res)=>{
  db.query(`
    UPDATE faculty SET
    name=?,type=?,subject=?,qualification=?,experience=?,previous_school=?,message=?
    WHERE id=?
  `,[
    req.body.name,
    req.body.type,
    req.body.subject,
    req.body.qualification,
    req.body.experience,
    req.body.previous_school,
    req.body.message,
    req.params.id
  ],(err)=>{
    res.json({msg:"updated"});
  });
};

// DELETE
exports.remove = (req,res)=>{
  db.query("DELETE FROM faculty WHERE id=?",[req.params.id],()=>{
    res.json({msg:"deleted"});
  });
};