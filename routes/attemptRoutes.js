const express = require('express');
const router = express.Router();
const passport = require('passport');

const Exam = require('../models/ExamSchema.js');
const Question = require('../models/QuestionSchema.js');
const Attempt = require('../models/AttemptSchema.js');
const checkAdmin = require('../middleware/checkAdmin.js');
const checkStudent = require('../middleware/checkStudent.js');
const { gradeAttempt, buildLeaderboard } = require('../utils/grading.js');

const requireAuth = passport.authenticate('jwt', { session: false });

// Questions as the student sees them - the answer key is stripped out
const toStudentQuestion = (question) => ({
    _id: question._id,
    questionText: question.questionText,
    options: question.options,
    marks: question.marks,
    order: question.order,
});

// An unfinished attempt past its deadline is graded on whatever was saved
const autoSubmitIfExpired = async (attempt, exam) => {
    if (attempt.status !== 'IN_PROGRESS') return attempt;
    if (Date.now() <= new Date(attempt.expiresAt).getTime()) return attempt;

    const saved = {};
    attempt.answers.forEach((answer) => {
        saved[String(answer.question)] = answer.selectedOption;
    });

    return gradeAttempt(attempt, exam, saved, 'AUTO_SUBMITTED');
};


////////////////////////////// TAKING AN EXAM //////////////////////////////


// ==================== START AN EXAM WITH A CODE ====================
router.post('/start', requireAuth, checkStudent, async (req, res) => {
    try {
        const { examCode } = req.body;

        if (!examCode) {
            return res.status(400).json({ error: 'Please enter the exam code' });
        }

        const exam = await Exam.findOne({
            examCode: String(examCode).toUpperCase().trim(),
            isPublished: true,
            isActive: true,
        });

        if (!exam) {
            return res.status(404).json({ error: 'No exam found with that code' });
        }

        const status = exam.getStatus();

        if (status === 'UPCOMING') {
            return res.status(403).json({
                error: 'This exam has not started yet',
                scheduledAt: exam.scheduledAt,
            });
        }

        if (status === 'ENDED') {
            return res.status(403).json({ error: 'This exam has already ended' });
        }

        if (exam.questionCount === 0) {
            return res.status(400).json({ error: 'This exam has no questions yet' });
        }

        // One account gets one attempt - resume it if it is still running
        const existing = await Attempt.findOne({ exam: exam._id, student: req.user._id });

        if (existing) {
            const settled = await autoSubmitIfExpired(existing, exam);

            if (settled.status !== 'IN_PROGRESS') {
                return res.status(409).json({
                    error: 'You have already taken this exam. Each account can attempt an exam only once.',
                    attemptId: settled._id,
                });
            }

            const questions = await Question.find({ exam: exam._id }).sort({ order: 1, createdAt: 1 });

            return res.json({
                message: 'Resuming your attempt',
                resumed: true,
                attempt: {
                    _id: settled._id,
                    startedAt: settled.startedAt,
                    expiresAt: settled.expiresAt,
                    answers: settled.answers,
                },
                exam: {
                    _id: exam._id,
                    title: exam.title,
                    subject: exam.subject,
                    durationMinutes: exam.durationMinutes,
                    totalMarks: exam.totalMarks,
                    questionCount: exam.questionCount,
                },
                questions: questions.map(toStudentQuestion),
            });
        }

        // The attempt can never run past the exam window
        const examEnd = exam.getEndTime();
        const byDuration = new Date(Date.now() + exam.durationMinutes * 60 * 1000);
        const expiresAt = byDuration < examEnd ? byDuration : examEnd;

        const attempt = new Attempt({
            exam: exam._id,
            student: req.user._id,
            expiresAt,
            totalMarks: exam.totalMarks,
            answers: [],
        });

        await attempt.save();

        const questions = await Question.find({ exam: exam._id }).sort({ order: 1, createdAt: 1 });

        res.status(201).json({
            message: 'Exam started',
            resumed: false,
            attempt: {
                _id: attempt._id,
                startedAt: attempt.startedAt,
                expiresAt: attempt.expiresAt,
                answers: [],
            },
            exam: {
                _id: exam._id,
                title: exam.title,
                subject: exam.subject,
                durationMinutes: exam.durationMinutes,
                totalMarks: exam.totalMarks,
                questionCount: exam.questionCount,
            },
            questions: questions.map(toStudentQuestion),
        });
    } catch (error) {
        // The unique (exam, student) index is the final guard against a double attempt
        if (error.code === 11000) {
            return res.status(409).json({ error: 'You have already taken this exam' });
        }
        console.error('Start exam error:', error);
        res.status(500).json({ error: 'Server error while starting the exam' });
    }
});

// ==================== SAVE ONE ANSWER ====================
router.put('/:attemptId/answer', requireAuth, checkStudent, async (req, res) => {
    try {
        const { questionId, selectedOption } = req.body;

        const attempt = await Attempt.findOne({ _id: req.params.attemptId, student: req.user._id });

        if (!attempt) {
            return res.status(404).json({ error: 'Attempt not found' });
        }

        const exam = await Exam.findById(attempt.exam);
        const settled = await autoSubmitIfExpired(attempt, exam);

        if (settled.status !== 'IN_PROGRESS') {
            return res.status(409).json({ error: 'Time is up. Your exam has been submitted.' });
        }

        const question = await Question.findOne({ _id: questionId, exam: attempt.exam });
        if (!question) {
            return res.status(404).json({ error: 'Question not found in this exam' });
        }

        const option = selectedOption === null || selectedOption === undefined ? null : Number(selectedOption);
        if (option !== null && (option < 0 || option > 3)) {
            return res.status(400).json({ error: 'selectedOption must be between 0 and 3' });
        }

        // Progress is stored without grading, so nothing leaks before submit
        const existing = attempt.answers.find((answer) => String(answer.question) === String(questionId));

        if (existing) {
            existing.selectedOption = option;
        } else {
            attempt.answers.push({ question: questionId, selectedOption: option });
        }

        await attempt.save();

        res.json({ message: 'Answer saved', questionId, selectedOption: option });
    } catch (error) {
        console.error('Save answer error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== SUBMIT THE EXAM ====================
router.post('/:attemptId/submit', requireAuth, checkStudent, async (req, res) => {
    try {
        const attempt = await Attempt.findOne({ _id: req.params.attemptId, student: req.user._id });

        if (!attempt) {
            return res.status(404).json({ error: 'Attempt not found' });
        }

        if (attempt.status !== 'IN_PROGRESS') {
            return res.status(409).json({ error: 'This exam has already been submitted' });
        }

        const exam = await Exam.findById(attempt.exam);

        // Start from what was saved, then apply whatever the client sends with the submit
        const merged = {};
        attempt.answers.forEach((answer) => {
            merged[String(answer.question)] = answer.selectedOption;
        });

        const incoming = req.body.answers;
        if (incoming && typeof incoming === 'object') {
            if (Array.isArray(incoming)) {
                incoming.forEach((answer) => {
                    if (answer && answer.questionId !== undefined) {
                        merged[String(answer.questionId)] = answer.selectedOption;
                    }
                });
            } else {
                Object.entries(incoming).forEach(([questionId, selectedOption]) => {
                    merged[questionId] = selectedOption;
                });
            }
        }

        const expired = Date.now() > new Date(attempt.expiresAt).getTime();
        await gradeAttempt(attempt, exam, merged, expired ? 'AUTO_SUBMITTED' : 'SUBMITTED');

        res.json({
            message: 'Exam submitted successfully',
            result: {
                attemptId: attempt._id,
                score: attempt.score,
                totalMarks: attempt.totalMarks,
                correctCount: attempt.correctCount,
                wrongCount: attempt.wrongCount,
                unansweredCount: attempt.unansweredCount,
                timeTakenSeconds: attempt.timeTakenSeconds,
                status: attempt.status,
            },
            // Rankings stay locked until the result window opens
            resultOpenTime: exam.getResultOpenTime(),
            resultVisible: exam.isResultVisible(),
        });
    } catch (error) {
        console.error('Submit exam error:', error);
        res.status(500).json({ error: 'Server error while submitting the exam' });
    }
});

// ==================== RESUME AN IN-PROGRESS ATTEMPT ====================
router.get('/active/:examId', requireAuth, checkStudent, async (req, res) => {
    try {
        const attempt = await Attempt.findOne({ exam: req.params.examId, student: req.user._id });

        if (!attempt) {
            return res.json({ active: false });
        }

        const exam = await Exam.findById(attempt.exam);
        const settled = await autoSubmitIfExpired(attempt, exam);

        if (settled.status !== 'IN_PROGRESS') {
            return res.json({ active: false, attempted: true, status: settled.status });
        }

        const questions = await Question.find({ exam: exam._id }).sort({ order: 1, createdAt: 1 });

        res.json({
            active: true,
            attempt: {
                _id: settled._id,
                startedAt: settled.startedAt,
                expiresAt: settled.expiresAt,
                answers: settled.answers,
            },
            exam: {
                _id: exam._id,
                title: exam.title,
                subject: exam.subject,
                durationMinutes: exam.durationMinutes,
                totalMarks: exam.totalMarks,
                questionCount: exam.questionCount,
            },
            questions: questions.map(toStudentQuestion),
        });
    } catch (error) {
        console.error('Active attempt error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


////////////////////////////// RESULTS //////////////////////////////


// ==================== MY ATTEMPT HISTORY ====================
router.get('/my', requireAuth, async (req, res) => {
    try {
        const attempts = await Attempt.find({ student: req.user._id })
            .populate('exam', 'title subject scheduledAt durationMinutes resultAvailableAfterHours resultVisibleForHours')
            .sort({ createdAt: -1 });

        const data = attempts.map((attempt) => {
            const exam = attempt.exam;

            return {
                _id: attempt._id,
                exam: exam ? { _id: exam._id, title: exam.title, subject: exam.subject, scheduledAt: exam.scheduledAt } : null,
                score: attempt.score,
                totalMarks: attempt.totalMarks,
                correctCount: attempt.correctCount,
                wrongCount: attempt.wrongCount,
                unansweredCount: attempt.unansweredCount,
                timeTakenSeconds: attempt.timeTakenSeconds,
                status: attempt.status,
                submittedAt: attempt.submittedAt,
                resultVisible: exam ? exam.isResultVisible() : false,
                resultOpenTime: exam ? exam.getResultOpenTime() : null,
                resultCloseTime: exam ? exam.getResultCloseTime() : null,
            };
        });

        res.json({ count: data.length, attempts: data });
    } catch (error) {
        console.error('My attempts error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== RESULT + LEADERBOARD FOR ONE EXAM ====================
// Locked until the result window opens, hidden again once it closes
router.get('/result/:examId', requireAuth, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.examId);

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        const myAttempt = await Attempt.findOne({ exam: exam._id, student: req.user._id });

        if (!myAttempt) {
            return res.status(404).json({ error: 'You did not take this exam' });
        }

        await autoSubmitIfExpired(myAttempt, exam);

        const now = Date.now();
        const openTime = exam.getResultOpenTime();
        const closeTime = exam.getResultCloseTime();

        if (now < openTime.getTime()) {
            return res.status(403).json({
                error: 'Results are not published yet',
                locked: true,
                resultOpenTime: openTime,
                resultCloseTime: closeTime,
            });
        }

        if (now > closeTime.getTime()) {
            return res.status(410).json({
                error: 'The result viewing window for this exam has closed',
                expired: true,
                resultCloseTime: closeTime,
            });
        }

        const attempts = await Attempt.find({ exam: exam._id }).populate('student', 'Name email profileImage');

        const leaderboard = buildLeaderboard(attempts);
        const myEntry = leaderboard.find((entry) => String(entry.student._id) === String(req.user._id));

        res.json({
            exam: {
                _id: exam._id,
                title: exam.title,
                subject: exam.subject,
                examCode: exam.examCode,
                scheduledAt: exam.scheduledAt,
                totalMarks: exam.totalMarks,
                passMarks: exam.passMarks,
            },
            myResult: {
                rank: myEntry ? myEntry.rank : null,
                score: myAttempt.score,
                totalMarks: myAttempt.totalMarks,
                correctCount: myAttempt.correctCount,
                wrongCount: myAttempt.wrongCount,
                unansweredCount: myAttempt.unansweredCount,
                timeTakenSeconds: myAttempt.timeTakenSeconds,
                passed: myAttempt.score >= (exam.passMarks || 0),
                status: myAttempt.status,
            },
            leaderboard,
            totalParticipants: leaderboard.length,
            resultCloseTime: closeTime,
        });
    } catch (error) {
        console.error('Result error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MY ANSWER SHEET ====================
// The answer key is only revealed inside the result window
router.get('/review/:examId', requireAuth, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.examId);

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        if (!exam.isResultVisible()) {
            return res.status(403).json({
                error: 'The answer sheet is not available right now',
                resultOpenTime: exam.getResultOpenTime(),
                resultCloseTime: exam.getResultCloseTime(),
            });
        }

        const attempt = await Attempt.findOne({ exam: exam._id, student: req.user._id });

        if (!attempt || attempt.status === 'IN_PROGRESS') {
            return res.status(404).json({ error: 'No submitted attempt found for this exam' });
        }

        const questions = await Question.find({ exam: exam._id }).sort({ order: 1, createdAt: 1 });
        const answerMap = new Map(attempt.answers.map((answer) => [String(answer.question), answer]));

        const review = questions.map((question) => {
            const answer = answerMap.get(String(question._id));

            return {
                _id: question._id,
                order: question.order,
                questionText: question.questionText,
                options: question.options,
                correctOption: question.correctOption,
                marks: question.marks,
                selectedOption: answer ? answer.selectedOption : null,
                isCorrect: answer ? answer.isCorrect : false,
                marksAwarded: answer ? answer.marksAwarded : 0,
            };
        });

        res.json({ exam: { _id: exam._id, title: exam.title }, review });
    } catch (error) {
        console.error('Review error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== RESULT + LEADERBOARD FOR ONE EXAM ====================
// Locked until the result window opens, hidden again once it closes
// router.get('/result/:examId', requireAuth, async (req, res) => {
//     try {
//         const exam = await Exam.findById(req.params.examId);

//         if (!exam) {
//             return res.status(404).json({ error: 'Exam not found' });
//         }

//         const myAttempt = await Attempt.findOne({ exam: exam._id, student: req.user._id });

//         if (!myAttempt) {
//             return res.status(404).json({ error: 'You did not take this exam' });
//         }

//         await autoSubmitIfExpired(myAttempt, exam);

//         const now = Date.now();
//         const openTime = exam.getResultOpenTime();
//         const closeTime = exam.getResultCloseTime();

//         // Check if result is upcoming (not yet open)
//         if (now < openTime.getTime()) {
//             return res.status(403).json({
//                 error: 'Results are not published yet',
//                 locked: true,
//                 resultOpenTime: openTime,
//                 resultCloseTime: closeTime,
//                 status: 'UPCOMING'
//             });
//         }

//         // Check if result window has closed
//         if (now > closeTime.getTime()) {
//             return res.status(410).json({
//                 error: 'The result viewing window for this exam has closed',
//                 expired: true,
//                 resultCloseTime: closeTime,
//                 status: 'EXPIRED'
//             });
//         }

//         // Result is available
//         const attempts = await Attempt.find({ 
//             exam: exam._id,
//             status: { $ne: 'IN_PROGRESS' }
//         }).populate('student', 'Name email profileImage');

//         // Build leaderboard with proper ranking
//         // Sort by score (descending) then by timeTakenSeconds (ascending)
//         const sortedAttempts = attempts.sort((a, b) => {
//             if (b.score !== a.score) {
//                 return b.score - a.score;
//             }
//             return a.timeTakenSeconds - b.timeTakenSeconds;
//         });

//         const leaderboard = sortedAttempts.map((attempt, index) => ({
//             rank: index + 1,
//             student: attempt.student,
//             score: attempt.score,
//             totalMarks: attempt.totalMarks,
//             correctCount: attempt.correctCount,
//             wrongCount: attempt.wrongCount,
//             unansweredCount: attempt.unansweredCount,
//             timeTakenSeconds: attempt.timeTakenSeconds,
//             attemptId: attempt._id,
//             passed: attempt.score >= (exam.passMarks || 0)
//         }));

//         // Find current user's rank
//         const myEntry = leaderboard.find((entry) => 
//             String(entry.student._id) === String(req.user._id)
//         );

//         res.json({
//             exam: {
//                 _id: exam._id,
//                 title: exam.title,
//                 subject: exam.subject,
//                 examCode: exam.examCode,
//                 scheduledAt: exam.scheduledAt,
//                 totalMarks: exam.totalMarks,
//                 passMarks: exam.passMarks,
//                 resultAvailableAfterHours: exam.resultAvailableAfterHours,
//                 resultVisibleForHours: exam.resultVisibleForHours
//             },
//             myResult: {
//                 rank: myEntry ? myEntry.rank : null,
//                 score: myAttempt.score,
//                 totalMarks: myAttempt.totalMarks,
//                 correctCount: myAttempt.correctCount,
//                 wrongCount: myAttempt.wrongCount,
//                 unansweredCount: myAttempt.unansweredCount,
//                 timeTakenSeconds: myAttempt.timeTakenSeconds,
//                 passed: myAttempt.score >= (exam.passMarks || 0),
//                 status: myAttempt.status
//             },
//             leaderboard,
//             totalParticipants: leaderboard.length,
//             resultOpenTime: openTime,
//             resultCloseTime: closeTime,
//             status: 'AVAILABLE'
//         });
//     } catch (error) {
//         console.error('Result error:', error);
//         res.status(500).json({ error: 'Server error' });
//     }
// });


////////////////////////////// ADMIN //////////////////////////////


// ==================== ALL RESULTS FOR AN EXAM ====================
// Admins are not bound by the student-facing result window
router.get('/admin/exam/:examId', requireAuth, checkAdmin, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.examId);

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        const attempts = await Attempt.find({ exam: exam._id }).populate(
            'student',
            'Name email profileImage isBlocked'
        );

        const leaderboard = buildLeaderboard(attempts);
        const inProgress = attempts.filter((attempt) => attempt.status === 'IN_PROGRESS').length;

        const scores = leaderboard.map((entry) => entry.score);
        const averageScore = scores.length
            ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
            : 0;
        const passCount = leaderboard.filter((entry) => entry.score >= (exam.passMarks || 0)).length;

        res.json({
            exam: exam.withTiming(),
            leaderboard,
            stats: {
                totalParticipants: leaderboard.length,
                inProgress,
                averageScore,
                highestScore: scores.length ? Math.max(...scores) : 0,
                lowestScore: scores.length ? Math.min(...scores) : 0,
                passCount,
                failCount: leaderboard.length - passCount,
            },
        });
    } catch (error) {
        console.error('Admin exam results error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DASHBOARD SUMMARY ====================
router.get('/admin/dashboard', requireAuth, checkAdmin, async (req, res) => {
    try {
        const User = require('../models/UserSchema.js');

        const [totalStudents, blockedStudents, totalExams, publishedExams, totalQuestions, totalAttempts] =
            await Promise.all([
                User.countDocuments({ role: 'STUDENT' }),
                User.countDocuments({ role: 'STUDENT', isBlocked: true }),
                Exam.countDocuments({}),
                Exam.countDocuments({ isPublished: true }),
                Question.countDocuments({}),
                Attempt.countDocuments({ status: { $ne: 'IN_PROGRESS' } }),
            ]);

        const exams = await Exam.find({ isActive: true }).sort({ scheduledAt: 1 });
        const liveExams = exams.filter((exam) => exam.getStatus() === 'LIVE');
        const upcomingExams = exams.filter((exam) => exam.getStatus() === 'UPCOMING').slice(0, 5);

        const recentAttempts = await Attempt.find({ status: { $ne: 'IN_PROGRESS' } })
            .populate('student', 'Name email profileImage')
            .populate('exam', 'title subject')
            .sort({ submittedAt: -1 })
            .limit(10);

        res.json({
            stats: {
                totalStudents,
                blockedStudents,
                totalExams,
                publishedExams,
                totalQuestions,
                totalAttempts,
                liveExams: liveExams.length,
            },
            liveExams: liveExams.map((exam) => exam.withTiming()),
            upcomingExams: upcomingExams.map((exam) => exam.withTiming()),
            recentAttempts,
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
