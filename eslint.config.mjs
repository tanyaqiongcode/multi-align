import js from "@eslint/js";
import globals from "globals";

/**
 * ESLint flat config（仅作用于独立 .js 文件；HTML 内联脚本不在覆盖范围）。
 * 目录分派依据各脚本的实际运行环境：
 *   js/、test/           —— 浏览器 <script> 加载的经典脚本（window.PA 命名空间）；
 *                           例外：test/check_coverage.js 为 Node CJS（覆盖率门槛检查）
 *   benchmark/、agent-skill/scripts/ —— Node CommonJS（现有 CI 直接 node 运行），
 *                           其测试脚手架在 VM 中注入 PA 全局后运行浏览器代码，
 *                           故 PA 同为已知全局
 *   analytics/           —— Cloudflare Worker（ES 模块）
 *
 * 对老代码的放宽（legacy 噪音，均为 lint 级别、不改业务语义）：
 *   - no-unused-vars 关闭对 args / catch 参数的检查，但未用局部变量仍为 error
 *     （历史代码大量 `catch (e) {}` 与未用的回调参数）
 *   - no-empty 允许空的 catch 块（同上，配合上条）
 *   - js/exporters.js 关闭 no-control-regex（CSV/XLSX 导出时清洗控制字符属刻意行为）
 */
export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/vendor/**", ".husky/_/**"],
  },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["js/**/*.js", "test/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, PA: "readonly" },
    },
  },
  {
    files: ["test/check_coverage.js", "test/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    files: ["benchmark/**/*.js", "agent-skill/scripts/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node, PA: "readonly" },
    },
  },
  {
    files: ["analytics/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },
  {
    files: ["js/exporters.js"],
    rules: {
      "no-control-regex": "off",
    },
  },
];
