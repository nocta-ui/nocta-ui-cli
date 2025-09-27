"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rollbackInitChanges = rollbackInitChanges;
const node_path_1 = __importDefault(require("node:path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
async function rollbackInitChanges(paths = []) {
    const uniquePaths = Array.from(new Set(paths));
    for (const targetPath of uniquePaths) {
        const normalizedPath = node_path_1.default.isAbsolute(targetPath)
            ? targetPath
            : node_path_1.default.join(process.cwd(), targetPath);
        if (!(await fs_extra_1.default.pathExists(normalizedPath))) {
            continue;
        }
        try {
            await fs_extra_1.default.remove(normalizedPath);
        }
        catch {
            // ignore cleanup errors during rollback
        }
    }
}
