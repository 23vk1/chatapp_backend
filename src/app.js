import cookieParser from "cookie-parser";
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { Server } from "socket.io";
import morganMiddleware from './logger/morgan.logger.js'
import { initializeSocketIO } from "./socket/index.js";
import dotenv from 'dotenv';
dotenv.config();


const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    pingTimeout :60000,
    cors : {
		origin: process.env.FRONTEND_URI,
        credentials : true,
    },
});

app.set("io", io);

app.use(cors({
	origin: process.env.FRONTEND_URI,
    credentials : true,
}));



app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cookieParser());


app.use(morganMiddleware);
import { errorHandler } from './middlewares/error.middlewares.js'

import userRoutes from './routes/apps/auth/user.routes.js'
import chatRoutes from './routes/apps/chat-app/chat.routes.js'
import messageRouter from "./routes/apps/chat-app/message.routes.js";




app.use("/api/v1/users", userRoutes);
app.use("/api/v1/chat-app/chats", chatRoutes);
app.use("/api/v1/chat-app/messages", messageRouter);

initializeSocketIO(io)

app.use(errorHandler);
export { httpServer }



