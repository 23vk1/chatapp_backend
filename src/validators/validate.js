import {validationResult} from 'express-validator';
import { errorHandler } from '../middlewares/error.middlewares.js';
import { ApiError } from '../utils/ApiError.js';


export const validate = (req, res, next) =>{
    const errors = validationResult(req);
    if(errors.isEmpty()){
        return next();
    }

    const extractedErrors = [];
    errors.array().map((err)=> extractedErrors.push({[err.path]: err.msg}));

    throw new ApiError(422, "Received data is not valid", extractedErrors);
}






