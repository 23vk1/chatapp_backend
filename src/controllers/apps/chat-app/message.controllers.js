import mongoose from "mongoose";
import { ChatEventEnum } from "../../../constants.js";
import { Chat } from "../../../models/apps/chat-app/chat.models.js";
import { ChatMessage } from "../../../models/apps/chat-app/message.models.js";
import { emitSocketEvent } from "../../../socket/index.js";
import { ApiError } from "../../../utils/ApiError.js";
import { ApiResponse } from "../../../utils/ApiResponse.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import {
    getLocalPath,
    getStaticFilePath,
    removeLocalFile,
} from "../../../utils/helpers.js";

import dotenv from 'dotenv';
dotenv.config();

import { v2 as cloudinary } from "cloudinary";
import fs from "fs/promises"; // for deleting local files

// setup cloudinary config if not already done
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});



const chatMessageCommonAggregation = () => {
    return [
        {
            $lookup: {
                from: "users",
                foreignField: "_id",
                localField: "sender",
                as: "sender",
                pipeline: [
                    {
                        $project: {
                            username: 1,
                            avatar: 1,
                            email: 1,
                        },
                    },
                ],
            },
        },
        {
            $addFields: {
                sender: { $first: "$sender" },
            },
        },
    ]
}

const getAllMessages = asyncHandler(async (req, res) => {
    const { chatId } = req.params;

    const selectedChat = await Chat.findById(chatId);
    if (!selectedChat) {
        throw new ApiError(404, "Chat does not exist");
    }

    if (!selectedChat.participants?.includes(req.user?._id)) {
        throw new ApiError(400, "User is not a part of this chat");
    }

    const messages = await ChatMessage.aggregate([
        {
            $match: {
                chat: new mongoose.Types.ObjectId(chatId)
            },
        },
        ...chatMessageCommonAggregation(),
        {
            $sort: {
                createdAt: -1,
            },
        },
    ]);

    return res
        .status(200)
        .json(new ApiResponse(200, messages || [], "Messages fetched successfully"));
});

const sendMessage = asyncHandler(async (req, res) => {
    const { chatId } = req.params;
    const { content } = req.body;

    if (!content && !req.files?.attachments?.length) {
        throw new ApiError(400, "Message contnent or Attachment required");
    }

    const selectedChat = await Chat.findById(chatId);

    if (!selectedChat) {
        throw new ApiError(404, "Chat does not exist");
    }

    // const messageFiles = [];

    // if (req.files && req.files.attachments?.length > 0) {
    //     req.files.attachments?.map((attachment) => {
    //         messageFiles.push({
    //             url: getStaticFilePath(req, attachment.filename),
    //             localPath: getLocalPath(attachment.filename),
    //         });
    //     });
    // }


    const messageFiles = [];

    if (req.files && req.files.attachments?.length > 0) {
        for (const attachment of req.files.attachments) {
            try {
                const result = await cloudinary.uploader.upload(attachment.path, {
                    folder: "chat-app/messages",
                    resource_type: "auto", // auto-detects images, video, etc.
                });

                messageFiles.push({
                    url: result.secure_url,
                    public_id: result.public_id, // optional: for deleting later
                });

                // Optional: delete file from local storage after upload
                await fs.unlink(attachment.path);
            } catch (err) {
                console.error("Cloudinary upload failed:", err);
            }
        }
    }



    const message = await ChatMessage.create({
        sender: new mongoose.Types.ObjectId(req.user._id),
        content: content || "",
        chat: new mongoose.Types.ObjectId(chatId),
        attachments: messageFiles,
    });

    const chat = await Chat.findByIdAndUpdate(
        chatId,
        {
            $set: {
                lastMessage: message._id,
            },
        },
        { new: true }
    );

    const messages = await ChatMessage.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(message._id),
            },
        },
        ...chatMessageCommonAggregation(),
    ]);

    const rececivedMessage = messages[0];

    if (!rececivedMessage) {
        throw new ApiError(500, "Internal server error");
    }

    chat.participants.forEach((participantObjectId) => {
        if (participantObjectId.toString() === req.user._id.toString()) return;

        emitSocketEvent(
            req,
            participantObjectId.toString(),
            ChatEventEnum.MESSAGE_RECEIVED_EVENT,
            rececivedMessage
        );
    });

    return res
        .status(201)
        .json(new ApiResponse(201, rececivedMessage, "Message saved successfully"));
});


const deleteMessage = asyncHandler(async (req, res) => {
    const { chatId, messageId } = req.params;

    const chat = await Chat.findOne({
        _id: new mmongoose.Types.ObjectId(chatId),
        participants: req.user?._id,
    });

    if (!chat) {
        throw new ApiError(404, "Chat does not exist");
    }

    const message = await ChatMessage.findOne({
        _id: new mongoose.Types.ObjectId(messageId),
    });

    if (!message) {
        throw new ApiError(404, "Message does not exist");
    }

    if (message.sender.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You are not the authorised to delete the message, you are not the sender");
    }

    if (message.attachments.length > 0) {
        message.attachments.map((asset) => {
            removeLocalFile(asset.localPath);
        });
    }

    await ChatMessage.deleteOne({
        _id: new mongoose.Types.ObjectId(messageId)
    });


    if (chat.lastMessage.toString() === message._id.toString()) {
        const lastMessage = await ChatMessage.findOne(
            { chat: chatId },
            {},
            { sort: { createdAt: -1 } }
        );
        await Chat.findByIdAndUpdate(chatId, {
            lastMessage: lastMessage ? lastMessage?._id : null
        });
    }

    chat.participants.forEach((participantObjectId) => {
        if (participantObjectId.toString() === req.user._id.toString()) return;

        emitSocketEvent(
            req,
            participantObjectId.toString(),
            ChatEventEnum.MESSAGE_DELETE_EVENT,
            message
        );
    });

    return res
        .status(200)
        .jsno(new ApiResponse(200, message, "Message deleted Successfully"));
});


export { getAllMessages, sendMessage, deleteMessage }
















