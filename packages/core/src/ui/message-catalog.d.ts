export type UiMessageLocale = "ko" | "en";
export type UiMessageMode = "beginner" | "advanced" | "admin";
export type UiMessageKey = "status.ready" | "status.needs_setup" | "status.needs_attention" | "status.warning" | "status.idle" | "component.setup" | "component.ai" | "component.channels" | "component.yeonjang" | "component.tasks" | "setup.ready.summary" | "setup.needs_setup.summary" | "setup.needs_setup.warning" | "setup.open.action" | "ai.ready.summary" | "ai.needs_setup.summary" | "ai.needs_setup.warning" | "ai.open.action" | "channels.ready.summary" | "channels.idle.summary" | "channels.idle.warning" | "channels.open.action" | "yeonjang.disabled.summary" | "yeonjang.connected.summary" | "yeonjang.empty.warning" | "yeonjang.open.action" | "tasks.ready.summary" | "tasks.running.summary" | "tasks.approval.summary" | "tasks.approval.warning" | "tasks.open.action" | "beginner.ready.summary" | "beginner.attention.summary" | "beginner.ready.status" | "beginner.attention.status" | "error.beginner.title" | "error.advanced.title" | "error.admin.title" | "error.repeated.title" | "error.repeated.action";
export declare const UI_MESSAGE_CATALOG: Record<UiMessageKey, Record<UiMessageLocale, string>>;
export declare function uiMessage(key: UiMessageKey, locale?: UiMessageLocale, params?: Record<string, string | number>): string;
export declare function assertUiMessageCatalogCoverage(): void;
export declare function findDisallowedUiTerms(mode: UiMessageMode, text: string): string[];
export interface UiErrorPresentation {
    mode: UiMessageMode;
    title: string;
    summary: string;
    nextAction: string;
    diagnosticCode: string;
    severity: "error" | "needs_attention";
    repeated: boolean;
    admin?: {
        kind: string;
        reason: string;
        sanitizedRaw: unknown;
    };
}
export declare function buildUiErrorPresentation(input: {
    rawError: string | Error | undefined;
    mode: UiMessageMode;
    locale?: UiMessageLocale;
    repeatCount?: number;
}): UiErrorPresentation;
//# sourceMappingURL=message-catalog.d.ts.map