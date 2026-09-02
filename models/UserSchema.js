const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        Name: {
            type: String,
            required: true,
            trim: true,
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },

        phone: {
            type: String,
            unique: true,
            sparse: true,
        },

        password: {
            type: String,
            required: true,
        },

        profileImage: {
            type: String,
            default: null,
        },

        // Role Management
        role: {
            type: String,
            enum: ["ADMIN", "STUDENT"],
            default: "STUDENT",
        },

        // Account Status
        isActive: {
            type: Boolean,
            default: true,
        },

        isBlocked: {
            type: Boolean,
            default: false,
        },

        isVerified: {
            type: Boolean,
            default: false,
        }
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("User", userSchema);
