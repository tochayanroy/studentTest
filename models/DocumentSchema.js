const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },

        description: {
            type: String,
            trim: true,
            default: "",
        },

        type: {
            type: String,
            enum: ["pdf", "text", "link", "zip"],
            required: true,
        },

        fileName: {
            type: String,
            trim: true,
        },

        fileUrl: {
            type: String,
            trim: true,
        },

        filePublicId: { 
            type: String, 
            trim: true 
        },
        
        fileResourceType: { 
            type: String, 
            default: "raw" 
        },

        isLocked: {
            type: Boolean,
            default: false,
        },

        lockCode: {
            type: Number,
            trim: true,
        },

        category: {
            type: String,
            enum: ["free", "complete", "projects"],
            required: true,
            default: "free",
        },

        tab: {
            type: String,
            enum: ["app", "agent", "prompt"],
            required: true,
            default: "app",
        },

        uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Document", documentSchema);