import type { SetupStepId } from "../contracts/setup"
import type { BeginnerSetupStepId } from "./beginner-setup"
import { BEGINNER_VISUALIZATION_GROUPS } from "./setup-visualization-beginner"
import type { SetupVisualizationRegistry } from "./setup-visualization-scenes"
import type { VisualizationScene } from "./setup-visualization"

export interface AdvancedVisualizationState {
  stepId: SetupStepId
  sceneId: string
  scene: VisualizationScene
  fallbackApplied: boolean
}

const ADVANCED_TO_BEGINNER_STEP: Partial<Record<SetupStepId, BeginnerSetupStepId>> = {
  welcome: "ai",
  personal: "ai",
  ai_backends: "ai",
  ai_routing: "ai",
  mcp: "computer",
  skills: "computer",
  security: "computer",
  channels: "channels",
  remote_access: "computer",
  review: "test",
  done: "test",
}

const BEGINNER_TO_ADVANCED_STEP_ORDER: Record<BeginnerSetupStepId, SetupStepId[]> = {
  ai: ["ai_backends", "personal", "ai_routing"],
  channels: ["channels"],
  computer: ["remote_access", "security", "mcp", "skills"],
  test: ["review", "done"],
}

export function buildAdvancedVisualizationState(input: {
  registry: SetupVisualizationRegistry
  currentStep: SetupStepId
}): AdvancedVisualizationState {
  const directSceneId = input.registry.sceneIdByStepId[input.currentStep]
  if (directSceneId) {
    return {
      stepId: input.currentStep,
      sceneId: directSceneId,
      scene: input.registry.scenesById[directSceneId]!,
      fallbackApplied: false,
    }
  }

  const beginnerStepId = mapAdvancedStepToBeginnerStep(input.currentStep)
  const fallbackStepId = BEGINNER_TO_ADVANCED_STEP_ORDER[beginnerStepId].find(
    (stepId) => Boolean(input.registry.sceneIdByStepId[stepId]),
  ) ?? "welcome"
  const fallbackSceneId = input.registry.sceneIdByStepId[fallbackStepId] ?? input.registry.sceneOrder[0]!

  return {
    stepId: fallbackStepId,
    sceneId: fallbackSceneId,
    scene: input.registry.scenesById[fallbackSceneId]!,
    fallbackApplied: fallbackStepId !== input.currentStep,
  }
}

export function mapAdvancedStepToBeginnerStep(stepId: SetupStepId): BeginnerSetupStepId {
  return ADVANCED_TO_BEGINNER_STEP[stepId] ?? "ai"
}

export function resolveAdvancedStepForBeginnerSelection(
  beginnerStepId: BeginnerSetupStepId,
  currentStep?: SetupStepId,
): SetupStepId {
  const orderedTargets = BEGINNER_TO_ADVANCED_STEP_ORDER[beginnerStepId]
  if (currentStep && orderedTargets.includes(currentStep)) {
    return currentStep
  }
  return orderedTargets[0]
}

export function beginnerSelectionCoversAdvancedStep(
  beginnerStepId: BeginnerSetupStepId,
  currentStep: SetupStepId,
): boolean {
  const orderedTargets = BEGINNER_TO_ADVANCED_STEP_ORDER[beginnerStepId]
  if (orderedTargets.includes(currentStep)) return true
  return BEGINNER_VISUALIZATION_GROUPS[beginnerStepId].semanticStepIds.includes(currentStep)
}
