



import { Router } from "express";

import {

  loginUser,
  logoutUser,
 
  registerUser,
} from "../../../controllers/apps/auth/user.controllers.js";
import {
  verifyJWT,
  
} from "../../../middlewares/auth.middlewares.js";

import { validate } from "../../../validators/validate.js";


const router = Router();


router.route("/register").post(validate, registerUser);
router.route("/login").post(validate, loginUser);

// Secured routes
router.route("/logout").post(verifyJWT, logoutUser);

export default router;


