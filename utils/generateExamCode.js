const Exam = require('../models/ExamSchema');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const randomCode = (length = 6) => {
    let code = '';
    for (let i = 0; i < length; i++) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return code;
};

// Generates a code that is not already used by another exam
const generateExamCode = async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
        const code = randomCode();
        const exists = await Exam.exists({ examCode: code });
        if (!exists) return code;
    }
    throw new Error('Could not generate a unique exam code');
};

module.exports = generateExamCode;
