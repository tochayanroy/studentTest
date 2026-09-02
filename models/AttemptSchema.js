const mongoose = require("mongoose");

const attemptSchema = new mongoose.Schema(
    {
        exam: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Exam",
            required: true,
            index: true,
        },

        student: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        answers: [
            {
                question: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Question",
                    required: true,
                },

                // null means the student left it unanswered
                selectedOption: {
                    type: Number,
                    default: null,
                    min: 0,
                    max: 3,
                },

                isCorrect: {
                    type: Boolean,
                    default: false,
                },

                marksAwarded: {
                    type: Number,
                    default: 0,
                },
            },
        ],

        score: {
            type: Number,
            default: 0,
        },

        totalMarks: {
            type: Number,
            default: 0,
        },

        correctCount: {
            type: Number,
            default: 0,
        },

        wrongCount: {
            type: Number,
            default: 0,
        },

        unansweredCount: {
            type: Number,
            default: 0,
        },

        startedAt: {
            type: Date,
            default: Date.now,
        },

        // Hard deadline for this attempt (start + duration, capped at exam end)
        expiresAt: {
            type: Date,
            required: true,
        },

        submittedAt: {
            type: Date,
            default: null,
        },

        timeTakenSeconds: {
            type: Number,
            default: 0,
        },

        status: {
            type: String,
            enum: ["IN_PROGRESS", "SUBMITTED", "AUTO_SUBMITTED"],
            default: "IN_PROGRESS",
        },
    },
    {
        timestamps: true,
    }
);

// One account can attempt an exam only once
attemptSchema.index({ exam: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("Attempt", attemptSchema);
