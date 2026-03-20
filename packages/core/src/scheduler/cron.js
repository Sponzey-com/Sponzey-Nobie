// Lightweight cron parser — supports standard 5-field cron expressions.
// Fields: minute  hour  day-of-month  month  day-of-week
// Supports: wildcard, step (every-n), specific value, range, list
function parseField(field, min, max) {
    const result = new Set();
    for (const part of field.split(",")) {
        if (part === "*") {
            for (let i = min; i <= max; i++)
                result.add(i);
        }
        else if (part.startsWith("*/")) {
            const step = parseInt(part.slice(2), 10);
            if (isNaN(step) || step <= 0)
                throw new Error(`Invalid cron step: ${part}`);
            for (let i = min; i <= max; i += step)
                result.add(i);
        }
        else if (part.includes("-")) {
            const [a, b] = part.split("-").map(Number);
            if (a === undefined || b === undefined || isNaN(a) || isNaN(b))
                throw new Error(`Invalid cron range: ${part}`);
            for (let i = a; i <= b; i++)
                result.add(i);
        }
        else {
            const n = parseInt(part, 10);
            if (isNaN(n))
                throw new Error(`Invalid cron value: ${part}`);
            result.add(n);
        }
    }
    return result;
}
export function parseCron(expr) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5)
        throw new Error(`Cron expression must have 5 fields: "${expr}"`);
    const [m, h, d, mo, wd] = parts;
    return {
        minutes: parseField(m, 0, 59),
        hours: parseField(h, 0, 23),
        days: parseField(d, 1, 31),
        months: parseField(mo, 1, 12),
        weekdays: parseField(wd, 0, 6),
    };
}
export function getNextRun(expr, from = new Date()) {
    const fields = parseCron(expr);
    // Start from the NEXT minute
    const d = new Date(from);
    d.setSeconds(0);
    d.setMilliseconds(0);
    d.setMinutes(d.getMinutes() + 1);
    // Search up to 4 years ahead
    const limit = new Date(from);
    limit.setFullYear(limit.getFullYear() + 4);
    while (d < limit) {
        if (!fields.months.has(d.getMonth() + 1)) {
            d.setMonth(d.getMonth() + 1);
            d.setDate(1);
            d.setHours(0);
            d.setMinutes(0);
            continue;
        }
        if (!fields.days.has(d.getDate()) || !fields.weekdays.has(d.getDay())) {
            d.setDate(d.getDate() + 1);
            d.setHours(0);
            d.setMinutes(0);
            continue;
        }
        if (!fields.hours.has(d.getHours())) {
            d.setHours(d.getHours() + 1);
            d.setMinutes(0);
            continue;
        }
        if (!fields.minutes.has(d.getMinutes())) {
            d.setMinutes(d.getMinutes() + 1);
            continue;
        }
        return d;
    }
    throw new Error(`No matching time found for cron: "${expr}"`);
}
/** Human-readable description of a cron expression (Korean) */
export function describeCron(expr) {
    try {
        const parts = expr.trim().split(/\s+/);
        if (parts.length !== 5)
            return expr;
        const [m, h, d, mo, wd] = parts;
        const isAll = (v) => v === "*";
        const isStep = (v) => v.startsWith("*/");
        if (isAll(m) && isAll(h) && isAll(d) && isAll(mo) && isAll(wd))
            return "매 분";
        if (isStep(m) && isAll(h) && isAll(d) && isAll(mo) && isAll(wd))
            return `매 ${m.slice(2)}분마다`;
        if (m === "0" && isStep(h) && isAll(d) && isAll(mo) && isAll(wd))
            return `매 ${h.slice(2)}시간마다`;
        if (!isAll(m) && !isAll(h) && isAll(d) && isAll(mo) && isAll(wd)) {
            return `매일 ${h}시 ${m}분`;
        }
        if (!isAll(m) && !isAll(h) && isAll(d) && isAll(mo) && wd === "1-5") {
            return `평일 ${h}시 ${m}분`;
        }
        if (!isAll(m) && !isAll(h) && isAll(d) && isAll(mo) && wd === "0,6") {
            return `주말 ${h}시 ${m}분`;
        }
        if (!isAll(m) && !isAll(h) && !isAll(d) && isAll(mo) && isAll(wd)) {
            return `매월 ${d}일 ${h}시 ${m}분`;
        }
        const next = getNextRun(expr);
        return `다음 실행: ${next.toLocaleString("ko-KR")}`;
    }
    catch {
        return expr;
    }
}
export function isValidCron(expr) {
    try {
        parseCron(expr);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=cron.js.map