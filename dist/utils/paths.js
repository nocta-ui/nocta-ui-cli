"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveComponentPath = resolveComponentPath;
const path_1 = __importDefault(require("path"));
function resolveComponentPath(componentFilePath, config) {
    const fileName = path_1.default.basename(componentFilePath);
    return path_1.default.join(config.aliases.components, fileName);
}
