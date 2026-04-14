import type { LoopDirective } from "./loop-directive.js";
import type { ExecutionCycleState } from "./execution-cycle-pass.js";
import type { RootLoopDependencies, RootLoopParams } from "./root-loop.js";
export interface RootLoopBootstrapState {
    intakeProcessed: boolean;
    pendingLoopDirective: LoopDirective | null;
    state: ExecutionCycleState;
}
export declare function prepareRootLoopBootstrapState(params: RootLoopParams, dependencies: RootLoopDependencies): RootLoopBootstrapState;
//# sourceMappingURL=root-loop-bootstrap-state.d.ts.map