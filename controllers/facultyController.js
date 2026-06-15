const db = require("../config/db");

// ALL FACULTY
exports.getAll = (req,res)=>{
  db.query("SELECT * FROM faculty",(err,result)=>{
    res.json(result);
  });
};

// PRINCIPAL
exports.getPrincipal = (req,res)=>{
  db.query("SELECT * FROM faculty WHERE type='principal' LIMIT 1",(err,result)=>{
    res.json(result[0]);
  });
};

// STAFF
exports.getStaff = (req,res)=>{
  db.query("SELECT * FROM faculty WHERE type='staff'",(err,result)=>{
    res.json(result);
  });
};

exports.getNonStaff = (req,res)=>{
  db.query("SELECT * FROM faculty WHERE type='Non-staff'",(err,result)=>{
    res.json(result);
  });
};
// SINGLE
exports.getOne = (req,res)=>{
  db.query("SELECT * FROM faculty WHERE id=?",[req.params.id],(err,result)=>{
    res.json(result[0]);
  });
};