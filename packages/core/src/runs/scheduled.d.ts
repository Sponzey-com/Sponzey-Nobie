export interface ScheduledRunExecutionOptions {
    toolsEnabled: boolean;
    contextMode: "isolated";
}
export declare function shouldDisableToolsForScheduledTask(task: string, taskProfile: string | undefined): boolean;
export declare function getScheduledRunExecutionOptions(task: string, taskProfile: string | undefined): ScheduledRunExecutionOptions;
export declare function extractDirectChannelDeliveryText(task: string): string | null;
export declare function buildScheduledFollowupPrompt(params: {
    task: string;
    goal?: string;
    taskProfile?: string;
    preferredTarget?: string;
    toolsEnabled: boolean;
    destination?: string;
}): string;
//# sourceMappingURL=scheduled.d.ts.map