const Question = require('../models/QuestionSchema');

// Scores an attempt against the answer key and writes the result onto the document.
// `submittedAnswers` is a map of questionId -> selectedOption (0-3 or null).
const gradeAttempt = async (attempt, exam, submittedAnswers = {}, status = 'SUBMITTED') => {
    const questions = await Question.find({ exam: exam._id }).sort({ order: 1, createdAt: 1 });

    let score = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;

    const answers = questions.map((question) => {
        const raw = submittedAnswers[String(question._id)];
        const selectedOption = raw === undefined || raw === null || raw === '' ? null : Number(raw);

        if (selectedOption === null || Number.isNaN(selectedOption)) {
            unansweredCount += 1;
            return { question: question._id, selectedOption: null, isCorrect: false, marksAwarded: 0 };
        }

        const isCorrect = selectedOption === question.correctOption;

        // Wrong answers only cost marks when the exam uses negative marking
        const marksAwarded = isCorrect ? question.marks : -(exam.negativeMarkPerWrong || 0);

        if (isCorrect) {
            correctCount += 1;
        } else {
            wrongCount += 1;
        }

        score += marksAwarded;

        return { question: question._id, selectedOption, isCorrect, marksAwarded };
    });

    const totalMarks = questions.reduce((sum, question) => sum + (question.marks || 0), 0);
    const submittedAt = new Date();

    attempt.answers = answers;
    // Negative marking must never push a result below zero
    attempt.score = Math.max(0, score);
    attempt.totalMarks = totalMarks;
    attempt.correctCount = correctCount;
    attempt.wrongCount = wrongCount;
    attempt.unansweredCount = unansweredCount;
    attempt.submittedAt = submittedAt;
    attempt.timeTakenSeconds = Math.max(
        0,
        Math.round((submittedAt.getTime() - new Date(attempt.startedAt).getTime()) / 1000)
    );
    attempt.status = status;

    await attempt.save();

    return attempt;
};

// Ranks finished attempts: highest score first, then whoever finished faster
const buildLeaderboard = (attempts) => {
    const finished = attempts.filter((attempt) => attempt.status !== 'IN_PROGRESS');

    finished.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.timeTakenSeconds !== b.timeTakenSeconds) return a.timeTakenSeconds - b.timeTakenSeconds;
        return new Date(a.submittedAt) - new Date(b.submittedAt);
    });

    return finished.map((attempt, index) => ({
        rank: index + 1,
        attemptId: attempt._id,
        student: attempt.student,
        score: attempt.score,
        totalMarks: attempt.totalMarks,
        correctCount: attempt.correctCount,
        wrongCount: attempt.wrongCount,
        unansweredCount: attempt.unansweredCount,
        timeTakenSeconds: attempt.timeTakenSeconds,
        submittedAt: attempt.submittedAt,
    }));
};

module.exports = { gradeAttempt, buildLeaderboard };
