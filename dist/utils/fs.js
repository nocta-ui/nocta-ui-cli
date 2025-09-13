"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileExists = fileExists;
exports.writeComponentFile = writeComponentFile;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
async function fileExists(filePath) {
    const fullPath = path_1.default.join(process.cwd(), filePath);
    return await fs_extra_1.default.pathExists(fullPath);
}
async function writeComponentFile(filePath, content) {
    const fullPath = path_1.default.join(process.cwd(), filePath);
    await fs_extra_1.default.ensureDir(path_1.default.dirname(fullPath));
    await fs_extra_1.default.writeFile(fullPath, content, "utf8");
}
