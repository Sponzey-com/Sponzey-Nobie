import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { getWorkspaceRootPath } from "../version.js";
const DEFAULT_REQUIRED_TASK_SECTIONS = [
    "목표",
    "기준 문서",
    "포함 기능",
    "구현 체크리스트",
    "검증 시나리오",
    "자동 테스트",
    "수동 smoke",
    "완료 조건",
    "관련 파일",
    "롤백 기준",
];
const REFERENCE_PREFIXES = [".tasks/", "packages/", "scripts/", "tests/", "prompts/", "docs/", "Yeonjang/", "README", ".design/"];
export function parseTaskMetadata(filePath, content, requiredTaskSections = DEFAULT_REQUIRED_TASK_SECTIONS) {
    const title = parseTitle(content) ?? basename(filePath);
    const status = parseStatus(content);
    const checkboxMatches = Array.from(content.matchAll(/^- \[(x|X| )\]/gm));
    const checkedItems = checkboxMatches.filter((match) => match[1]?.toLowerCase() === "x").length;
    const totalItems = checkboxMatches.length;
    const sections = parseSections(content);
    const missingSections = requiredTaskSections.filter((section) => !hasSection(sections, section));
    const autoSection = extractSection(content, "자동 테스트");
    const smokeSection = extractSection(content, "수동 smoke");
    const verificationSection = [extractSection(content, "검증 결과"), extractSection(content, "검증 명령")].filter(Boolean).join("\n");
    const evidenceCommands = extractEvidenceCommands(`${autoSection}\n${smokeSection}\n${verificationSection}`);
    const hasAutomatedEvidence = hasCheckedItem(autoSection) || evidenceCommands.some((command) => /\b(test|typecheck|build|doctor|smoke)\b/.test(command));
    const hasManualSmokeEvidence = hasCheckedItem(smokeSection);
    const manualOnly = /manual-only|수동\s*smoke\s*대기|수동\s*검증\s*대기/i.test(content);
    const completed = /완료|complete|completed/i.test(status) || (totalItems > 0 && checkedItems === totalItems && hasSection(sections, "완료 조건"));
    const hasEvidence = hasAutomatedEvidence || hasManualSmokeEvidence || manualOnly;
    return {
        path: normalizeDisplayPath(filePath),
        title,
        status,
        completed,
        checkedItems,
        totalItems,
        sections,
        missingSections,
        evidenceCommands,
        hasAutomatedEvidence,
        hasManualSmokeEvidence,
        manualOnly,
        hasEvidence,
    };
}
export function runPlanDriftCheck(options = {}) {
    const rootDir = resolve(options.rootDir ?? getWorkspaceRootPath());
    const requiredSections = options.requiredTaskSections ?? DEFAULT_REQUIRED_TASK_SECTIONS;
    const phasePlans = buildPhasePlanStatus(rootDir);
    const tasks = listRootTaskFiles(rootDir).map((filePath) => parseTaskMetadata(relative(rootDir, filePath), readFileSync(filePath, "utf-8"), requiredSections));
    const warnings = [];
    for (const plan of phasePlans) {
        if (!plan.exists) {
            warnings.push({
                code: "phase_plan_missing",
                severity: "warning",
                path: plan.path,
                message: `${plan.phase} plan 문서가 없습니다.`,
                detail: { phase: plan.phase },
            });
        }
    }
    for (const task of tasks) {
        for (const section of task.missingSections) {
            warnings.push({
                code: "missing_required_section",
                severity: "warning",
                path: task.path,
                message: `Task evidence 필수 섹션이 없습니다: ${section}`,
                detail: { section, title: task.title },
            });
        }
        if (task.completed && !task.hasEvidence) {
            warnings.push({
                code: "completed_without_evidence",
                severity: "warning",
                path: task.path,
                message: "완료 상태 task에 자동 테스트, 수동 smoke, manual-only evidence 표시가 없습니다.",
                detail: { title: task.title, status: task.status },
            });
        }
    }
    for (const docPath of listPlanDriftSourceFiles(rootDir)) {
        const relativePath = normalizeDisplayPath(relative(rootDir, docPath));
        const content = readFileSync(docPath, "utf-8");
        for (const reference of extractPathReferences(content)) {
            if (!pathReferenceExists(rootDir, reference)) {
                warnings.push({
                    code: "missing_referenced_path",
                    severity: "warning",
                    path: relativePath,
                    message: `문서에 적힌 경로가 repo에 없습니다: ${reference}`,
                    detail: { reference },
                });
            }
        }
    }
    const currentPlanPath = join(rootDir, ".tasks", "plan.md");
    if (existsSync(currentPlanPath)) {
        const currentPlan = readFileSync(currentPlanPath, "utf-8");
        for (const plan of phasePlans) {
            if (!plan.exists)
                continue;
            const pattern = new RegExp(`${escapeRegExp(plan.phase)}\\/plan\\.md[^\\n]*(존재하지|없|missing)`, "i");
            if (pattern.test(currentPlan)) {
                warnings.push({
                    code: "plan_outdated_claim",
                    severity: "info",
                    path: ".tasks/plan.md",
                    message: `${plan.phase} plan 복구 상태와 current plan 설명이 충돌합니다.`,
                    detail: { phase: plan.phase, planPath: plan.path },
                });
            }
        }
    }
    const releaseNoteEvidence = buildReleaseNoteEvidenceSummary(tasks, warnings);
    const blockedCount = warnings.filter((warning) => warning.severity === "blocked").length;
    return {
        kind: "nobie.plan-drift.report",
        version: 1,
        rootDir,
        createdAt: (options.now ?? new Date()).toISOString(),
        phasePlans,
        tasks,
        warnings,
        summary: {
            taskCount: tasks.length,
            completedTaskCount: tasks.filter((task) => task.completed).length,
            warningCount: warnings.filter((warning) => warning.severity === "warning").length,
            blockedCount,
            missingEvidenceCount: warnings.filter((warning) => warning.code === "completed_without_evidence").length,
        },
        releaseNoteEvidence,
    };
}
export function buildReleaseNoteEvidenceSummary(tasks, warnings) {
    const missingEvidencePaths = new Set(warnings.filter((warning) => warning.code === "completed_without_evidence").map((warning) => warning.path));
    const warningCounts = Object.fromEntries(["phase_plan_missing", "missing_required_section", "completed_without_evidence", "missing_referenced_path", "plan_outdated_claim"].map((code) => [code, 0]));
    for (const warning of warnings)
        warningCounts[warning.code] += 1;
    return {
        verifiedTasks: tasks
            .filter((task) => task.completed && task.hasEvidence && !task.manualOnly && !missingEvidencePaths.has(task.path))
            .map((task) => ({ path: task.path, title: task.title, status: task.status, evidenceCommands: task.evidenceCommands })),
        manualOnlyTasks: tasks
            .filter((task) => task.completed && task.manualOnly)
            .map((task) => ({ path: task.path, title: task.title, status: task.status })),
        unverifiedTasks: tasks
            .filter((task) => task.completed && missingEvidencePaths.has(task.path))
            .map((task) => ({ path: task.path, title: task.title, status: task.status, reason: "completed_without_evidence" })),
        pendingTasks: tasks
            .filter((task) => !task.completed)
            .map((task) => ({ path: task.path, title: task.title, status: task.status })),
        warningsByCode: warningCounts,
    };
}
function buildPhasePlanStatus(rootDir) {
    return ["phase001", "phase002"].map((phase) => {
        const relativePath = `.tasks/${phase}/plan.md`;
        return { phase, path: relativePath, exists: existsSync(join(rootDir, relativePath)) };
    });
}
function listRootTaskFiles(rootDir) {
    const tasksDir = join(rootDir, ".tasks");
    if (!existsSync(tasksDir))
        return [];
    return readdirSync(tasksDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^task\d+\.md$/i.test(entry.name))
        .map((entry) => join(tasksDir, entry.name))
        .sort();
}
function listPlanDriftSourceFiles(rootDir) {
    const files = [];
    const currentPlan = join(rootDir, ".tasks", "plan.md");
    if (existsSync(currentPlan))
        files.push(currentPlan);
    for (const task of listRootTaskFiles(rootDir))
        files.push(task);
    for (const plan of buildPhasePlanStatus(rootDir)) {
        const fullPath = join(rootDir, plan.path);
        if (existsSync(fullPath))
            files.push(fullPath);
    }
    return unique(files);
}
function parseTitle(content) {
    const match = content.match(/^#\s+(.+)$/m);
    return match?.[1]?.trim() ?? null;
}
function parseStatus(content) {
    const match = content.match(/^>?\s*상태\s*:\s*(.+)$/m);
    return match?.[1]?.trim() ?? "상태 미기재";
}
function parseSections(content) {
    return Array.from(content.matchAll(/^#{2,4}\s+(.+)$/gm))
        .map((match) => normalizeSection(match[1] ?? ""))
        .filter(Boolean);
}
function hasSection(sections, required) {
    const normalizedRequired = normalizeSection(required);
    return sections.some((section) => section.includes(normalizedRequired) || normalizedRequired.includes(section));
}
function normalizeSection(value) {
    return value
        .replace(/^\d+(?:\.\d+)*\s*/, "")
        .replace(/^[-–—]\s*/, "")
        .replace(/[`*_]/g, "")
        .trim()
        .toLowerCase();
}
function extractSection(content, title) {
    const headings = Array.from(content.matchAll(/^#{2,4}\s+(.+)$/gm));
    const wanted = normalizeSection(title);
    for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        if (!heading || !normalizeSection(heading[1] ?? "").includes(wanted))
            continue;
        const start = heading.index ?? 0;
        const nextHeading = headings.slice(index + 1).find((candidate) => (candidate.index ?? 0) > start);
        return content.slice(start, nextHeading?.index ?? content.length);
    }
    return "";
}
function hasCheckedItem(content) {
    return /^- \[[xX]\]/m.test(content);
}
function extractEvidenceCommands(content) {
    const commands = Array.from(content.matchAll(/`([^`\n]*(?:pnpm|npm|node|cargo|vitest|nobie|bash|scripts\/)[^`\n]*)`/g))
        .map((match) => match[1]?.trim() ?? "")
        .filter(Boolean);
    return unique(commands);
}
function extractPathReferences(content) {
    const references = Array.from(content.matchAll(/`([^`\n]+)`/g))
        .map((match) => sanitizePathReference(match[1] ?? ""))
        .filter((reference) => reference !== null);
    return unique(references);
}
function sanitizePathReference(raw) {
    let value = raw.trim().replace(/[),.;:]+$/g, "");
    if (!value || value.includes(" "))
        return null;
    value = value.replace(/#L\d+(?:C\d+)?$/i, "");
    if (!REFERENCE_PREFIXES.some((prefix) => value.startsWith(prefix)))
        return null;
    return value;
}
function pathReferenceExists(rootDir, reference) {
    if (reference.includes("*"))
        return globReferenceExists(rootDir, reference);
    return existsSync(join(rootDir, reference));
}
function globReferenceExists(rootDir, reference) {
    const starIndex = reference.indexOf("*");
    const slashBeforeStar = reference.lastIndexOf("/", starIndex);
    const baseRelative = slashBeforeStar >= 0 ? reference.slice(0, slashBeforeStar) : ".";
    const basePath = join(rootDir, baseRelative);
    if (!existsSync(basePath))
        return false;
    const pattern = new RegExp(`^${escapeRegExp(reference).replace(/\\\*/g, "[^/]*")}$`);
    return listFilesRecursive(basePath).some((filePath) => pattern.test(normalizeDisplayPath(relative(rootDir, filePath))));
}
function listFilesRecursive(rootDir) {
    const stat = statSync(rootDir);
    if (stat.isFile())
        return [rootDir];
    if (!stat.isDirectory())
        return [];
    const files = [];
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist")
            continue;
        const fullPath = join(rootDir, entry.name);
        if (entry.isDirectory())
            files.push(...listFilesRecursive(fullPath));
        else if (entry.isFile())
            files.push(fullPath);
    }
    return files;
}
function normalizeDisplayPath(path) {
    return path.split(sep).join("/");
}
function unique(items) {
    return Array.from(new Set(items));
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//# sourceMappingURL=plan-drift.js.map