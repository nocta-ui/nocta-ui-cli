"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rollbackInitChanges = rollbackInitChanges;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
async function rollbackInitChanges() {
    const filesToCheck = [
        "nocta.config.json",
        "tailwind.config.js",
        "tailwind.config.ts",
        "lib/utils.ts",
        "src/lib/utils.ts",
    ];
    for (const file of filesToCheck) {
        const fullPath = path_1.default.join(process.cwd(), file);
        if (await fs_extra_1.default.pathExists(fullPath)) {
            try {
                await fs_extra_1.default.remove(fullPath);
            }
            catch {
                // ignore
            }
        }
    }
}
