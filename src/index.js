import dotenv from 'dotenv';
import { httpServer } from './app.js';
import connectDb from './db/index.js';
import logger from './logger/winston.logger.js';

dotenv.config({
    path:"./.env"
});


const startServer = ()=>{
    httpServer.listen(8080, ()=>{
        logger.info("Server is running on port: " + process.env.PORT);
    })
};

try{
    await connectDb();
    startServer();
}catch(error){
   logger.error("Mongo db connect error: ", error);
}








