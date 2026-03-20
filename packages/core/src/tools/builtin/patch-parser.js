export function parsePatch(patch) {
    const lines = patch.split(/\r?\n/);
    const operations = [];
    let hasDeletes = false;
    let i = 0;
    // Skip *** Begin Patch line if present
    if (lines[i]?.trim() === "*** Begin Patch") {
        i++;
    }
    while (i < lines.length) {
        const line = lines[i] ?? "";
        if (line.trim() === "*** End Patch") {
            break;
        }
        if (line.startsWith("*** Update File:")) {
            const filePath = line.slice("*** Update File:".length).trim();
            i++;
            const hunks = [];
            let currentHunk = null;
            while (i < lines.length) {
                const l = lines[i] ?? "";
                if (l.startsWith("***"))
                    break;
                if (l.startsWith("@@ ")) {
                    // Save previous hunk if exists
                    if (currentHunk !== null && currentHunk.changes.length > 0) {
                        hunks.push(currentHunk);
                    }
                    const contextHint = l.slice(3).trim();
                    currentHunk = {
                        context: contextHint ? [contextHint] : [],
                        changes: [],
                    };
                    i++;
                    continue;
                }
                if (currentHunk === null) {
                    // Create implicit hunk if no @@ found yet
                    currentHunk = { context: [], changes: [] };
                }
                if (l.startsWith("-")) {
                    currentHunk.changes.push({ op: "remove", line: l.slice(1) });
                }
                else if (l.startsWith("+")) {
                    currentHunk.changes.push({ op: "add", line: l.slice(1) });
                }
                else if (l.startsWith(" ")) {
                    currentHunk.changes.push({ op: "context", line: l.slice(1) });
                }
                else {
                    // Treat as context line
                    currentHunk.changes.push({ op: "context", line: l });
                }
                i++;
            }
            if (currentHunk !== null && currentHunk.changes.length > 0) {
                hunks.push(currentHunk);
            }
            operations.push({ type: "update", filePath, hunks });
            continue;
        }
        if (line.startsWith("*** Add File:")) {
            const filePath = line.slice("*** Add File:".length).trim();
            i++;
            const contentLines = [];
            while (i < lines.length) {
                const l = lines[i] ?? "";
                if (l.startsWith("***"))
                    break;
                contentLines.push(l);
                i++;
            }
            operations.push({ type: "add", filePath, content: contentLines.join("\n") });
            continue;
        }
        if (line.startsWith("*** Delete File:")) {
            const filePath = line.slice("*** Delete File:".length).trim();
            hasDeletes = true;
            operations.push({ type: "delete", filePath });
            i++;
            continue;
        }
        i++;
    }
    return { operations, hasDeletes };
}
//# sourceMappingURL=patch-parser.js.map