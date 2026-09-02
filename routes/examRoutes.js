const express = require('express');
const router = express.Router();
const passport = require('passport');

const Exam = require('../models/ExamSchema.js');
const Question = require('../models/QuestionSchema.js');
const Attempt = require('../models/AttemptSchema.js');
const checkAdmin = require('../middleware/checkAdmin.js');
const generateExamCode = require('../utils/generateExamCode.js');
const { recalcExamTotals, resequenceQuestions } = require('../utils/examStats.js');

const requireAuth = passport.authenticate('jwt', { session: false });


////////////////////////////// STUDENT //////////////////////////////


// ==================== EXAMS VISIBLE TO THE STUDENT ====================
// Published exams, each tagged with this student's attempt state
router.get('/available', requireAuth, async (req, res) => {
    try {
        const exams = await Exam.find({ isPublished: true, isActive: true }).sort({ scheduledAt: 1 });

        const attempts = await Attempt.find({ student: req.user._id }).select('exam status score totalMarks submittedAt');
        const attemptMap = new Map(attempts.map((attempt) => [String(attempt.exam), attempt]));

        const data = exams.map((exam) => {
            const attempt = attemptMap.get(String(exam._id));

            return exam.withTiming({
                // The exam code is never sent to the student - they must type it
                examCode: undefined,
                attempted: Boolean(attempt),
                attemptStatus: attempt ? attempt.status : null,
                myScore: attempt && attempt.status !== 'IN_PROGRESS' ? attempt.score : null,
            });
        });

        res.json({ count: data.length, exams: data });
    } catch (error) {
        console.error('Available exams error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== EXAM DETAIL FOR A STUDENT ====================
// Metadata only - never the questions or the answer key
router.get('/available/:id', requireAuth, async (req, res) => {
    try {
        const exam = await Exam.findOne({ _id: req.params.id, isPublished: true, isActive: true });

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        const attempt = await Attempt.findOne({ exam: exam._id, student: req.user._id });

        res.json({
            exam: exam.withTiming({
                examCode: undefined,
                attempted: Boolean(attempt),
                attemptStatus: attempt ? attempt.status : null,
            }),
        });
    } catch (error) {
        console.error('Exam detail error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


////////////////////////////// ADMIN //////////////////////////////


// ==================== CREATE EXAM ====================
router.post('/', requireAuth, checkAdmin, async (req, res) => {
    try {
        const {
            title,
            description,
            subject,
            examCode,
            scheduledAt,
            durationMinutes,
            passMarks,
            negativeMarkPerWrong,
            resultAvailableAfterHours,
            resultVisibleForHours,
            isPublished,
        } = req.body;

        if (!title || !scheduledAt) {
            return res.status(400).json({ error: 'Title and scheduled date are required' });
        }

        // Use the supplied code if free, otherwise mint one
        let code = examCode ? String(examCode).toUpperCase().trim() : null;
        if (code) {
            const taken = await Exam.exists({ examCode: code });
            if (taken) {
                return res.status(400).json({ error: 'That exam code is already in use' });
            }
        } else {
            code = await generateExamCode();
        }

        const exam = new Exam({
            title,
            description,
            subject,
            examCode: code,
            scheduledAt,
            durationMinutes: durationMinutes || 30,
            passMarks: passMarks || 0,
            negativeMarkPerWrong: negativeMarkPerWrong || 0,
            resultAvailableAfterHours: resultAvailableAfterHours ?? 24,
            resultVisibleForHours: resultVisibleForHours ?? 24,
            isPublished: Boolean(isPublished),
            createdBy: req.user._id,
        });

        await exam.save();

        res.status(201).json({ message: 'Exam created successfully', exam: exam.withTiming() });
    } catch (error) {
        console.error('Create exam error:', error);
        res.status(500).json({ error: 'Server error while creating exam' });
    }
});

// ==================== LIST ALL EXAMS ====================
router.get('/', requireAuth, checkAdmin, async (req, res) => {
    try {
        const { search, status } = req.query;

        const filter = {};

        if (search) {
            const regex = new RegExp(String(search).trim(), 'i');
            filter.$or = [{ title: regex }, { subject: regex }, { examCode: regex }];
        }

        const exams = await Exam.find(filter).sort({ scheduledAt: -1 });

        // How many students sat each exam
        const counts = await Attempt.aggregate([
            { $match: { status: { $ne: 'IN_PROGRESS' } } },
            { $group: { _id: '$exam', total: { $sum: 1 } } },
        ]);
        const countMap = new Map(counts.map((c) => [String(c._id), c.total]));

        let data = exams.map((exam) =>
            exam.withTiming({ participantCount: countMap.get(String(exam._id)) || 0 })
        );

        if (status) {
            data = data.filter((exam) => exam.status === String(status).toUpperCase());
        }

        res.json({ count: data.length, exams: data });
    } catch (error) {
        console.error('List exams error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== EXAM DETAIL WITH QUESTIONS ====================
router.get('/:id', requireAuth, checkAdmin, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.id);

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        const questions = await Question.find({ exam: exam._id }).sort({ order: 1, createdAt: 1 });
        const participantCount = await Attempt.countDocuments({
            exam: exam._id,
            status: { $ne: 'IN_PROGRESS' },
        });

        res.json({ exam: exam.withTiming({ participantCount }), questions });
    } catch (error) {
        console.error('Exam detail error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== UPDATE EXAM ====================
router.put('/:id', requireAuth, checkAdmin, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.id);

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        const editable = [
            'title',
            'description',
            'subject',
            'scheduledAt',
            'durationMinutes',
            'passMarks',
            'negativeMarkPerWrong',
            'resultAvailableAfterHours',
            'resultVisibleForHours',
            'isPublished',
            'isActive',
        ];

        editable.forEach((field) => {
            if (req.body[field] !== undefined) {
                exam[field] = req.body[field];
            }
        });

        // Changing the code is allowed while it stays unique
        if (req.body.examCode) {
            const code = String(req.body.examCode).toUpperCase().trim();
            const taken = await Exam.exists({ examCode: code, _id: { $ne: exam._id } });
            if (taken) {
                return res.status(400).json({ error: 'That exam code is already in use' });
            }
            exam.examCode = code;
        }

        await exam.save();

        res.json({ message: 'Exam updated successfully', exam: exam.withTiming() });
    } catch (error) {
        console.error('Update exam error:', error);
        res.status(500).json({ error: 'Server error while updating exam' });
    }
});

// ==================== PUBLISH / UNPUBLISH ====================
router.put('/:id/publish', requireAuth, checkAdmin, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.id);

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        const nextState = typeof req.body.isPublished === 'boolean' ? req.body.isPublished : !exam.isPublished;

        if (nextState && exam.questionCount === 0) {
            return res.status(400).json({ error: 'Add at least one question before publishing' });
        }

        exam.isPublished = nextState;
        await exam.save();

        res.json({
            message: exam.isPublished ? 'Exam published' : 'Exam unpublished',
            isPublished: exam.isPublished,
        });
    } catch (error) {
        console.error('Publish exam error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== REGENERATE EXAM CODE ====================
router.put('/:id/regenerateCode', requireAuth, checkAdmin, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.id);

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        exam.examCode = await generateExamCode();
        await exam.save();

        res.json({ message: 'Exam code regenerated', examCode: exam.examCode });
    } catch (error) {
        console.error('Regenerate code error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DELETE EXAM ====================
router.delete('/:id', requireAuth, checkAdmin, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.id);

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        // Remove the questions and attempts that belong to this exam
        await Question.deleteMany({ exam: exam._id });
        await Attempt.deleteMany({ exam: exam._id });
        await Exam.findByIdAndDelete(exam._id);

        res.json({ message: 'Exam deleted successfully' });
    } catch (error) {
        console.error('Delete exam error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


////////////////////////////// ADMIN - QUESTIONS OF AN EXAM //////////////////////////////


// ==================== LIST QUESTIONS ====================
router.get('/:id/questions', requireAuth, checkAdmin, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.id);

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        const questions = await Question.find({ exam: exam._id }).sort({ order: 1, createdAt: 1 });

        res.json({ count: questions.length, questions });
    } catch (error) {
        console.error('List questions error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADD QUESTION ====================
router.post('/:id/questions', requireAuth, checkAdmin, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.id);

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        const { questionText, options, correctOption, marks } = req.body;

        if (!questionText || !Array.isArray(options) || options.length !== 4) {
            return res.status(400).json({ error: 'A question needs text and exactly 4 options' });
        }

        if (correctOption === undefined || correctOption < 0 || correctOption > 3) {
            return res.status(400).json({ error: 'correctOption must be between 0 and 3' });
        }

        const existingCount = await Question.countDocuments({ exam: exam._id });

        const question = new Question({
            exam: exam._id,
            questionText,
            options,
            correctOption,
            marks: marks || 1,
            order: existingCount + 1,
        });

        await question.save();
        await recalcExamTotals(exam._id);

        res.status(201).json({ message: 'Question added successfully', question });
    } catch (error) {
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        console.error('Add question error:', error);
        res.status(500).json({ error: 'Server error while adding question' });
    }
});

// ==================== UPDATE QUESTION ====================
router.put('/:id/questions/:questionId', requireAuth, checkAdmin, async (req, res) => {
    try {
        const question = await Question.findOne({ _id: req.params.questionId, exam: req.params.id });

        if (!question) {
            return res.status(404).json({ error: 'Question not found' });
        }

        const { questionText, options, correctOption, marks, order } = req.body;

        if (options !== undefined) {
            if (!Array.isArray(options) || options.length !== 4) {
                return res.status(400).json({ error: 'A question needs exactly 4 options' });
            }
            question.options = options;
        }

        if (correctOption !== undefined) {
            if (correctOption < 0 || correctOption > 3) {
                return res.status(400).json({ error: 'correctOption must be between 0 and 3' });
            }
            question.correctOption = correctOption;
        }

        if (questionText !== undefined) question.questionText = questionText;
        if (marks !== undefined) question.marks = marks;
        if (order !== undefined) question.order = order;

        await question.save();
        await recalcExamTotals(question.exam);

        res.json({ message: 'Question updated successfully', question });
    } catch (error) {
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        console.error('Update question error:', error);
        res.status(500).json({ error: 'Server error while updating question' });
    }
});

// ==================== DELETE QUESTION ====================
router.delete('/:id/questions/:questionId', requireAuth, checkAdmin, async (req, res) => {
    try {
        const question = await Question.findOne({ _id: req.params.questionId, exam: req.params.id });

        if (!question) {
            return res.status(404).json({ error: 'Question not found' });
        }

        const examId = question.exam;

        await Question.findByIdAndDelete(question._id);
        await resequenceQuestions(examId);
        await recalcExamTotals(examId);

        res.json({ message: 'Question deleted successfully' });
    } catch (error) {
        console.error('Delete question error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
