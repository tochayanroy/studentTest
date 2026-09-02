const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
    {
        exam: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Exam",
            required: true,
            index: true,
        },

        questionText: {
            type: String,
            required: true,
            trim: true,
        },

        // Exactly 4 options, matching the design
        options: {
            type: [String],
            required: true,
            validate: {
                validator: function (value) {
                    return Array.isArray(value) &&
                        value.length === 4 &&
                        value.every((option) => typeof option === "string" && option.trim().length > 0);
                },
                message: "A question must have exactly 4 non-empty options",
            },
        },

        // Index (0-3) of the correct option
        correctOption: {
            type: Number,
            required: true,
            min: 0,
            max: 3,
        },

        marks: {
            type: Number,
            default: 1,
            min: 0,
        },

        // Position of the question inside the exam (Q1, Q2, ...)
        order: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
);

questionSchema.index({ exam: 1, order: 1 });

module.exports = mongoose.model("Question", questionSchema);
