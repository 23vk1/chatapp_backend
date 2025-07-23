import cookie from "cookie";
import jwt from 'jsonwebtoken';
import { Server, Socket } from "socket.io";
import { AvailableChatEvents, ChatEventEnum } from "../constants.js";
import { User } from "../models/apps/auth/user.models.js";
import { ApiError } from "../utils/ApiError.js";



const mountJoinChatEvent = (socket) => {
    socket.on(ChatEventEnum.JOIN_CHAT_EVENT, (chatId) => {
        console.log(`user joined the chat -> chat_id : `, chatId);
        socket.join(chatId);
    });
}


const mountParticipantTypingEvent = (socket) => {
    socket.on(ChatEventEnum.TYPING_EVENT, (chatId) => {
        socket.in(chatId).emit(ChatEventEnum.TYPING_EVENT, chatId);
    });
};


const mountParticipantStoppedTypingEvent = (socket) => {
    socket.on(ChatEventEnum.STOP_TYPING_EVENT, (chatId) => {
        socket.in(chatId).emit(ChatEventEnum.STOP_TYPING_EVENT, chatId);
    });
};


const initializeSocketIO = (io) => {
    return io.on("connection", async (socket) => {
        try {
            const cookies = cookie.parse(socket.handshake.headers?.cookie || "");

            let token = cookies?.accessToken;
            if (!token) {
                token = socket.handshake.auth?.token;
            };
            if (!token) {
                throw new ApiError(401, "Un-Authorised handshake. Token is missing");
            };

            const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

            const user = await User.findById(decodedToken?._id).select(
                "-password"
            );
            if (!user) {
                throw new ApiError(401, "Un-Authorised handshake. Token is missing");
            };

            socket.user = user;
            socket.join(user._id.toString());
            socket.emit(ChatEventEnum.CONNECTED_EVENT);
            console.log("User connected.. UserID : ", user._id.toString());

            mountJoinChatEvent(socket);
            mountParticipantTypingEvent(socket);
            mountParticipantStoppedTypingEvent(socket);

            socket.on(ChatEventEnum.DISCONNECT_EVENT, () => {
                console.log("User has Dissconnected.  UserId : ", socket.user?._id);
                if (socket.user?._id) {
                    socket.leave(socket.user._id);
                }
            });

        } catch (error) {
            socket.emit(
                ChatEventEnum.SOCKET_ERROR_EVENT,
                error?.message || "Somthing Went Wrong while connecting the socket"
            );
        }
    });
};


const emitSocketEvent = (req, roomId, event, payload) =>{
    req.app.get("io").in(roomId).emit(event, payload);
};

export {
    initializeSocketIO,
    emitSocketEvent
}




















