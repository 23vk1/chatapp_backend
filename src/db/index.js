import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";
import logger from "../logger/winston.logger.js";



export let dbInstance = undefined;

const connectDb = async () => {
    try {
        const connectionInstance = await mongoose.connect(
            `${process.env.MONGODB_URI}/${DB_NAME}`
        );
        dbInstance = connectionInstance;
        logger.info(
            `MongoDB Connected! Host : ${connectionInstance.connection.host}`
        );
    } catch (error) {
        logger.error("MongoDB connection error: ", error);
        process.exit(1);
    }
}

export default connectDb;

