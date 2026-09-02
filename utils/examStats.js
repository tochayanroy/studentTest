const Exam = require('../models/ExamSchema');
const Question = require('../models/QuestionSchema');

// Keeps questionCount / totalMarks on the exam in sync with its questions
const recalcExamTotals = async (examId) => {
    const questions = await Question.find({ exam: examId }).select('marks');

    const questionCount = questions.length;
    const totalMarks = questions.reduce((sum, question) => sum + (question.marks || 0), 0);

    await Exam.findByIdAndUpdate(examId, { $set: { questionCount, totalMarks } });

    return { questionCount, totalMarks };
};

// Re-numbers questions as 1..n so the student sees Q1, Q2, ... with no gaps
const resequenceQuestions = async (examId) => {
    const questions = await Question.find({ exam: examId }).sort({ order: 1, createdAt: 1 });

    await Promise.all(
        questions.map((question, index) => {
            if (question.order === index + 1) return null;
            return Question.findByIdAndUpdate(question._id, { $set: { order: index + 1 } });
        })
    );
};

module.exports = { recalcExamTotals, resequenceQuestions };
