const mongoose = require("mongoose");

const examSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },

        description: {
            type: String,
            trim: true,
        },

        subject: {
            type: String,
            trim: true,
        },

        // Code the student must type to enter the exam
        examCode: {
            type: String,
            required: true,
            unique: true,
            uppercase: true,
            trim: true,
            index: true,
        },

        // Schedule
        scheduledAt: {
            type: Date,
            required: true,
        },

        durationMinutes: {
            type: Number,
            required: true,
            min: 1,
            default: 30,
        },

        // Marking
        totalMarks: {
            type: Number,
            default: 0,
        },

        passMarks: {
            type: Number,
            default: 0,
        },

        negativeMarkPerWrong: {
            type: Number,
            default: 0,
            min: 0,
        },

        questionCount: {
            type: Number,
            default: 0,
        },

        // Result visibility window (hours, measured from exam end)
        resultAvailableAfterHours: {
            type: Number,
            default: 24,
        },

        resultVisibleForHours: {
            type: Number,
            default: 24,
        },

        isPublished: {
            type: Boolean,
            default: false,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// ==================== TIME WINDOW HELPERS ====================

examSchema.methods.getEndTime = function () {
    return new Date(this.scheduledAt.getTime() + this.durationMinutes * 60 * 1000);
};

examSchema.methods.getResultOpenTime = function () {
    return new Date(this.getEndTime().getTime() + this.resultAvailableAfterHours * 60 * 60 * 1000);
};

examSchema.methods.getResultCloseTime = function () {
    return new Date(this.getResultOpenTime().getTime() + this.resultVisibleForHours * 60 * 60 * 1000);
};

// LIVE while running, UPCOMING before, ENDED after
examSchema.methods.getStatus = function () {
    const now = Date.now();
    if (now < this.scheduledAt.getTime()) return "UPCOMING";
    if (now <= this.getEndTime().getTime()) return "LIVE";
    return "ENDED";
};

// Result is only visible inside the [open, close] window
examSchema.methods.isResultVisible = function () {
    const now = Date.now();
    return now >= this.getResultOpenTime().getTime() && now <= this.getResultCloseTime().getTime();
};

// Adds the computed fields to a plain object for API responses
examSchema.methods.withTiming = function (extra = {}) {
    const obj = this.toObject();
    return {
        ...obj,
        endTime: this.getEndTime(),
        resultOpenTime: this.getResultOpenTime(),
        resultCloseTime: this.getResultCloseTime(),
        status: this.getStatus(),
        resultVisible: this.isResultVisible(),
        ...extra,
    };
};

module.exports = mongoose.model("Exam", examSchema);
