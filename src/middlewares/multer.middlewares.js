import multer from "multer";

const storage = multer.memoryStorage();
// const storage = multer.diskStorage({
//     destination: function (req, file, cb) {
//         cb(null, "./public/images");
//     },

//     filename: function (req, file, cb) {
//         let fileExtention = ""
//         if (file.originalname.split(".").length > 1) {
//             fileExtention = file.originalname.substring(
//                 file.originalname.lastIndexOf(".")
//             );
//         }
//         const filenameWithoutExtention = file.originalname.toLowerCase().split(" ").join("-")?.split(".")[0];

//         cb(
//             null,
//             filenameWithoutExtention +
//             Date.now() +
//             Math.ceil(Math.random() * 1e5) +
//             fileExtention   
//         );
//     },
// });

export const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1000 * 1000,
    },
});




