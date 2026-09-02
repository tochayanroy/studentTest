const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.DATABASE_URL);

const db = mongoose.connection;

db.on('connected', () => {
    console.log('MongoDB Connected Successfully');
});

db.on('error', () => {
    console.log('MongoDB Connection Failed');
});

db.on('disconnected', () => {
    console.log('MongoDB Disconnected');
});

module.exports = db;
