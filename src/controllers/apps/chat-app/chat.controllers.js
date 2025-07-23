import mongoose, { mongo } from "mongoose";

import { ChatEventEnum } from "../../../constants.js";
import { User } from "../../../models/apps/auth/user.models.js";
import { Chat } from "../../../models/apps/chat-app/chat.models.js";
import { ChatMessage } from "../../../models/apps/chat-app/message.models.js";

import { emitSocketEvent } from "../../../socket/index.js";
import { ApiError } from "../../../utils/ApiError.js";
import { ApiResponse } from '../../../utils/ApiResponse.js';
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { removeLocalFile } from "../../../utils/helpers.js";



const chatCommonAggregation = () => {

    return [
        {
            $lookup: {
                from: "users",
                foreignField: "_id",
                localField: "participants",
                as: "participants",
                pipeline: [
                    {
                        $project: {
                            password: 0,
                            refreshToken : 0,
                            forgotPasswordToken : 0,
                            forgotPasswordExpiry :0,
                            emailVerificationToken :0,
                            emailVerificationExpiry : 0,
                        },
                    },
                ],
            },
        },
        {
            $lookup: {
                from: "chatmessages",
                foreignField: "_id",
                localField: "lastMessage",
                as: "lastMessage",
                pipeline: [
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
                                        email: 1
                                    },
                                },
                            ]
                        },
                    },
                    {
                        $addFields: {
                            sender: { $first: "$sender" },
                        }
                    }
                ],
            },
        },
        {
            $addFields: {
                lastMessage: {
                    $first: "$lastMessage"
                },
            },
        },
    ];
};


const deleteCascadeChatMessages = async (chatId) => {
    const messages = await ChatMessage.find({
        chat: new mongoose.Types.ObjectId(chatId)
    });
    let attachments = [];

    attachments = attachments.concat(
        ...messages.map((message) => {
            return message.attachments;
        })
    );

    attachments.forEach((attachment) => {
        removeLocalFile(attachment.localPath)
    });

    await ChatMessage.deleteMany({
        chat: new mongoose.Types.ObjectId(chatId)
    });
}


const searchAvailableUsers = asyncHandler(async (req, res) => {
    const users = await User.aggregate([
        {
            $match: {
                _id: {
                    $ne: req.user._id,
                },
            },
        },
        {
            $project: {
                avatar: 1,
                username: 1,
                email: 1,
            },
        },
    ]);
    return res
        .status(200)
        .json(new ApiResponse(200, users, "Users fetched successfully"));
});


const createOrGetAOneOnOneChat = asyncHandler(async (req, res) => {
    const { receiverId } = req.params;
    const receiver = await User.findById(receiverId);

    if (!receiver) {
        throw new ApiError(400, "Receiver does not exists");
    };
    if (receiver._id.toString() === req.user._id.toString()) {
        throw new ApiError(400, "You can not chat with yourself");
    };

    const chat = await Chat.aggregate([
        {
            $match: {
                isGroupChat: false,
                $and: [
                    {
                        participants: { $elemMatch: { $eq: req.user._id } }
                    },
                    {
                        participants: {
                            $elemMatch: { $eq: new mongoose.Types.ObjectId(receiverId) },
                        },
                    },
                ],
            },
        },
        ...chatCommonAggregation(),
    ]);

    if (chat.length) {
        return res
            .status(200)
            .json(new ApiResponse(200, chat[0], "Chat retrived successfully"));
    };

    const newChatInstance = await Chat.create({
        name: "One on one chat",
        participants: [req.user._id, new mongoose.Types.ObjectId(receiverId)],
        admin: req.user._id,
    });

    const createChat = await Chat.aggregate([
        {
            $match: {
                _id: newChatInstance._id,
            },
        },
        ...chatCommonAggregation(),
    ]);

    const payload = createChat[0];

    if (!payload) {
        throw new ApiError(500, "Internal server error");
    }

    payload?.participants?.forEach((participant) => {
        if (participant._id.toString() === req.user._id.toString()) return;

        emitSocketEvent(
            req,
            participant._id?.toString(),
            ChatEventEnum.NEW_CHAT_EVENT,
            payload
        );
    });

    return res
        .status(201)
        .json(new ApiResponse(201, payload, "Chat retrived successsfully"));
});


const createAGroupChat = asyncHandler(async (req, res) => {
    const { name, participants } = req.body;

    if (participants.includes(req.user._id.toString())) {
        throw new ApiError(400, "Participants array should not contain the group creator");
    };

    const members = [...new Set([...participants, req.user._id.toString()])];

    if (members.length < 3) {
        throw new ApiError(400, "Seems like you have passed duplicate participants");
    }

    const groupChat = await Chat.create({
        name,
        isGroupChat: true,
        participants: members,
        admin: req.user._id,
    });

    const chat = await Chat.aggregate([
        {
            $match: {
                _id: groupChat._id,
            },
        },
        ...chatCommonAggregation(),
    ]);

    const payload = chat[0];

    if (!payload) {
        throw new ApiError(500, "Internal server error");
    }

    payload?.participants?.forEach((participant) => {
        if (participant._id.toString() === req.user._id.toString()) return;

        emitSocketEvent(
            req,
            participant._id?.toString(),
            ChatEventEnum.NEW_CHAT_EVENT,
            payload,
        )
    });

    return res
        .status(201)
        .json(new ApiResponse(201, payload, "Group chat created successfully"));
})


const getGroupChatDetails = asyncHandler(async (req, res) => {
    const { chatId } = req.params;
    const groupChat = await Chat.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(chatId),
                isGroupChat: true,
            },
        },
        ...chatCommonAggregation(),
    ]);

    const chat = groupChat[0];
    if (!chat) {
        throw new ApiError(404, "Group chat does not exist");
    }
    return res
        .status(200)
        .json(new ApiResponse(200, chat, "Group chat fetched successfully"));
})


const renameGroupChat = asyncHandler(async (req, res) => {
    const { chatId } = req.params;
    const { name } = req.body;

    const groupChat = await Chat.findOne({
        _id: new mongoose.Types.ObjectId(chatId),
        isGroupChat: true,
    });

    if (!groupChat) {
        throw new ApiError(404, "Group chat dos ont exist");
    }

    if (groupChat.admin?.toString() !== req.user._id?.toString()) {
        throw new ApiError(404, "you are not an admin");
    }

    const updatedGroupChat = await Chat.findByIdAndUpdate(
        chatId,
        {
            $set: {
                name,
            },
        },
        { new: true }
    );

    const chat = await Chat.aggregate([
        {
            $match: {
                _id: updatedGroupChat._id,
            },
        },
        ...chatCommonAggregation(),
    ]);

    const payload = chat[0];

    if (!payload) {
        throw new ApiError(500, "Internal server error");
    }

    payload?.participants?.forEach((participant) => {
        emitSocketEvent(
            req,
            participant._id?.toString(),
            ChatEventEnum.UPDATE_GROUP_NAME_EVENT,
            payload,
        );
    });

    return res
        .status(200)
        .json(new ApiResponse(200, chat[0], "Group chat name updated successfully"));
});


const deleteGroupChat = asyncHandler(async (req, res) => {
    const { chatId } = req.params;

    const groupChat = await Chat.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(chatId),
                isGroupChat: true,
            },
        },
        ...chatCommonAggregation(),
    ]);

    const chat = groupChat[0];

    if (!chat) {
        throw new ApiError(404, "Group chat does not exist");
    }

    if (chat?.admin?.toString() !== req.user._id?.toString()) {
        throw new ApiError(404, "Only admin can delete the group");
    }

    await Chat.findByIdAndDelete();

    await deleteCascadeChatMessages(chatId);

    chat?.participants?.forEach((participant) => {
        if (participant._id.toString() === req.user._id.toString()) return;

        emitSocketEvent(
            req,
            participant._id?.toString(),
            ChatEventEnum.LEAVE_CHAT_EVENT,
            chat
        );
    });

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Group chat deleted successfully"));
});


const deleteOneOnOneChat = asyncHandler(async (req, res) => {
    const { chatId } = req.params;

    const chat = await Chat.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(chatId),
            },
        },
        ...chatCommonAggregation(),
    ]);

    const payload = chat[0];

    if (!payload) {
        throw new ApiError(404, "Chat does not exist");
    }

    await Chat.findByIdAndDelete(chatId);

    await deleteCascadeChatMessages(chatId);

    const otherParticipant = payload?.participants?.find(
        (participant) => participant?._id.toString() !== req.user._id.toString()
    );
    emitSocketEvent(
        req,
        otherParticipant._id?.toString(),
        ChatEventEnum.LEAVE_CHAT_EVENT,
        payload
    );

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Chat Deleted successfully"));
})

const leaveGroupChat = asyncHandler(async (req, res) => {
    const { chatId } = req.params;

    const groupChat = await Chat.findOne({
        _id: new mongoose.Types.ObjectId(chatId),
        isGroupChat: true
    });

    if (!groupChat) {
        throw new ApiError(404, "Group chat does not exist");
    }

    const existingParticipants = groupChat.participants;

    if (!existingParticipants?.includes(req.user?._id)) {
        throw new ApiError(400, "You are not a part of this group chat");
    }

    const updatedChat = await Chat.findByIdAndUpdate(
        chatId,
        {
            $pull: {
                participants: req.user?._id,
            },
        },
        { new: true }
    );

    const chat = await Chat.aggregate([
        {
            $match: {
                _id: updatedChat._id,
            },
        },
        ...chatCommonAggregation()
    ]);

    const payload = chat[0];

    if (!payload) {
        throw new ApiError(500, "Internal server Error");
    }

    return res
        .status(200)
        .json(new ApiResponse(200, payload, "Left a Group successfully"));
});


const addNewParticipantInGroupChat = asyncHandler(async (req, res) => {
    const { chatId, participantId } = req.params;

    const groupChat = await Chat.findOne({
        _id: new mongoose.Types.ObjectId(chatId),
        isGroupChat: true
    });

    if (!groupChat) {
        throw new ApiError(404, "Group chat does not exist");
    }

    if (groupChat.admin?.toString() !== req.user._id?.toString()) {
        throw new ApiError(404, "You are nont an admin");
    }

    const existingParticipants = groupChat.participants;

    if (existingParticipants?.includes(participantId)) {
        throw new ApiError(409, "Participant already in a group chat");
    }

    const updatedChat = await Chat.findByIdAndUpdate(
        chatId,
        {
            $push: {
                participants: participantId,
            },
        },
        { new: true }
    );

    const chat = await Chat.aggregate([
        {
            $match: {
                _id: updatedChat._id,
            },
        },
        ...chatCommonAggregation(),
    ]);

    const payload = chat[0];

    if (!payload) {
        throw new ApiError(500, "Internal server error");
    }

    emitSocketEvent(
        req,
        participantId,
        ChatEventEnum.NEW_CHAT_EVENT,
        payload,
    );
    return res
        .status(200)
        .json(new ApiResponse(200, payload, "Participant added successfully"));
});


const removeParticipantFromGroupChat = asyncHandler(async (req, res) => {
    const { chatId, participantId } = req.params;

    const groupChat = await Chat.findOne({
        _id: new mongoose.Types.ObjectId(chatId),
        isGroupChat: true,
    });

    if (!groupChat) {
        throw new ApiError(404, "Group chat does not exist");
    }

    if (groupChat.admin?.toString() !== req.user._id?.toString()) {
        throw new ApiError(404, "You are not an admin");
    }

    const existingParticipants = groupChat.participants;

    if (!existingParticipants?.includes(participantId)) {
        throw new ApiError(400, "Participant does not exist in the group chat");
    }

    const updatedChat = await Chat.findByIdAndUpdate(
        chatId,
        {
            $pull: {
                participants: participantId,
            },
        },
        { new: true }
    );

    const chat = await Chat.aggregate([
        {
            $match: {
                _id: updatedChat._id,
            },
        },
        ...chatCommonAggregation(),
    ]);

    const payload = chat[0];

    if(!payload){
        throw new ApiError(500, "Internal Server Error");
    }

    emitSocketEvent(
        req,
        participantId,
        ChatEventEnum.LEAVE_CHAT_EVENT,
        payload,
    );

    return res
        .status(200)
        .json(new ApiResponse(200, payload, "Participant removed successfully"));
});


const getAllChats = asyncHandler(async(req, res) =>{
    const chats = await Chat.aggregate([
        {
            $match : {
                participants : {
                    $elemMatch :{$eq : req.user._id}
                },
            }
        },
        {
            $sort : {
                updatedAt : -1,
            },
        },
        ...chatCommonAggregation(),
    ]);

    return res
        .status(200)
        .json(new ApiResponse(200, chats || [], "User chats fetched successfully"));
});



export {
    addNewParticipantInGroupChat,
    createAGroupChat,
    createOrGetAOneOnOneChat,
    deleteGroupChat,
    deleteOneOnOneChat,
    getAllChats,
    getGroupChatDetails,
    leaveGroupChat,
    removeParticipantFromGroupChat,
    renameGroupChat,
    searchAvailableUsers
}




















