import * as React from "react"
import type { VisualizationNode, VisualizationOverlayTone, VisualizationScene, VisualizationStatus } from "../../lib/setup-visualization"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function SetupVisualizationLegend({
  scene,
  language,
}: {
  scene: VisualizationScene
  language: UiLanguage
}) {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)

  return (
    <div className="rounded-[1.75rem] border border-stone-200 bg-white/90 p-4 shadow-sm" data-setup-visual-legend={scene.id}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
          {t("시각화 범례", "Visualization legend")}
        </div>
        <div className="text-xs text-stone-500">{scene.nodes.length} {t("노드", "nodes")}</div>
        <div className="text-xs text-stone-500">{scene.edges.length} {t("연결선", "edges")}</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["ready", "warning", "error", "required", "draft", "disabled"] as VisualizationStatus[]).map((status) => (
          <span key={status} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass(status)}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(status)}`} />
            {statusLabel(status, language)}
          </span>
        ))}
      </div>
    </div>
  )
}

export function SetupVisualizationCanvas({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
  onDismissSelection,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
  onDismissSelection?: () => void
}) {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const canvasDescriptionId = `${scene.id}-description`
  const outlineId = `${scene.id}-outline`
  const flowHighlights = scene.edges.filter((edge) => edge.status === "warning" || edge.status === "error" || (edge.overlayTones?.length ?? 0) > 0)

  return (
    <section
      role="region"
      aria-label={scene.label}
      aria-describedby={`${canvasDescriptionId} ${outlineId}`}
      className="overflow-hidden rounded-[2rem] border border-stone-200 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.95),_rgba(239,232,219,0.9)_55%,_rgba(230,223,210,0.95))] shadow-[0_24px_80px_rgba(15,23,42,0.08)]"
      data-setup-visual-canvas={scene.id}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onDismissSelection?.()
        }
      }}
    >
      <div className="border-b border-stone-200/80 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              {t("시각화 장면", "Visualization scene")}
            </div>
            <h3 className="mt-2 text-xl font-semibold text-stone-900">{scene.label}</h3>
            <p className="mt-2 text-sm leading-6 text-stone-600" id={canvasDescriptionId}>
              {scene.id === "scene:welcome"
                ? t("설정 전체 흐름과 준비 상태를 한 번에 확인합니다.", "Review the full setup flow and readiness at a glance.")
                : scene.id === "scene:personal"
                  ? t("프로필, 언어, 시간대, 작업 폴더가 이후 동작에 어떤 영향을 주는지 보여줍니다.", "Shows how identity, language, timezone, and workspace affect later behavior.")
                  : scene.id === "scene:ai_backends"
                    ? t("Nobie Core Router를 중심으로 활성 AI와 대기 AI를 구분해 보여줍니다.", "Centers the Nobie Core Router and separates the live AI from standby connections.")
                    : scene.id === "scene:ai_routing"
                      ? t("routingProfiles가 현재 어떤 순서로 backend에 연결되는지 확장 장면으로 보여줍니다.", "Shows the current routingProfiles order as an advanced expansion scene.")
                      : scene.id === "scene:mcp"
                        ? t("MCP 서버를 transport cluster로 나누고, 준비된 외부 도구 수를 capability map으로 보여줍니다.", "Groups MCP servers by transport cluster and shows external tool readiness as a capability map.")
                        : scene.id === "scene:skills"
                          ? t("Skill을 source cluster로 나누고, 어떤 항목이 즉시 사용 가능하거나 검증이 필요한지 보여줍니다.", "Groups skills by source cluster and shows which entries are ready or still need verification.")
                          : scene.id === "scene:security"
                            ? t("승인 게이트, 타임아웃, 후속 처리 제한이 어디서 위험 구역으로 이어지는지 경계 지도로 보여줍니다.", "Shows how the approval gate, timeout, and delegation limit flow into the restricted zone.")
                            : scene.id === "scene:channels"
                              ? t("WebUI를 기본 채널로 두고 Telegram과 Slack의 policy/runtime 상태를 네트워크 맵으로 보여줍니다.", "Uses WebUI as the root channel and shows Telegram and Slack policy/runtime state as a network map.")
                              : scene.id === "scene:remote_access"
                                ? t("Host/port, auth boundary, MQTT bridge, external client zone을 하나의 연결 구조로 묶어 보여줍니다.", "Shows host/port, auth boundary, MQTT bridge, and the external client zone as one connection structure.")
                                : scene.id === "scene:review"
                                  ? t("설정 완료 직전의 readiness tile과 위험 경로를 board 관점으로 요약합니다.", "Summarizes readiness tiles and risk paths right before setup completion.")
                  : scene.id === "scene:done"
                                    ? t("설정 완료 후 현재 활성 구조를 AI, 채널, 확장, 저장 상태 기준으로 요약합니다.", "Summarizes the active structure after setup across AI, channels, extensions, and storage.")
                              : t("현재 단계의 구조를 지도로 보여줍니다.", "Shows the structure of the current step as a map.")}
            </p>
          </div>
          <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-xs leading-5 text-stone-600">
            <div>{t("선택한 노드를 클릭하면 강조 표시가 바뀝니다.", "Click a node to change the highlight.")}</div>
            <div>{t("상태 색상은 저장/검증 준비도를 반영합니다.", "Status colors reflect save and validation readiness.")}</div>
          </div>
        </div>
      </div>

      {scene.alerts?.length ? (
        <div className="flex flex-wrap gap-2 border-b border-stone-200/70 bg-white/70 px-5 py-3 sm:px-6" data-setup-visual-alerts={scene.id}>
          {scene.alerts.map((alert) => (
            <span key={alert.id} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${alertClass(alert.tone)}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${alertDotClass(alert.tone)}`} />
              {alert.message}
            </span>
          ))}
        </div>
      ) : null}

      {flowHighlights.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-b border-stone-200/70 bg-stone-50/90 px-5 py-3 sm:px-6" data-setup-visual-flows={scene.id}>
          {flowHighlights.map((edge) => (
            <span
              key={edge.id}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${edge.status === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${edge.status === "error" ? "bg-red-500" : "bg-amber-500"}`} />
              {describeEdge(edge, scene, language)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="px-5 py-5 sm:px-6 sm:py-6">
        {scene.id === "scene:welcome" ? (
          <WelcomeSceneLayout scene={scene} language={language} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : scene.id === "scene:personal" ? (
          <PersonalSceneLayout scene={scene} language={language} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : scene.id === "scene:ai_backends" ? (
          <AiBackendsSceneLayout scene={scene} language={language} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : scene.id === "scene:ai_routing" ? (
          <AiRoutingSceneLayout scene={scene} language={language} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : scene.id === "scene:mcp" ? (
          <McpSceneLayout scene={scene} language={language} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : scene.id === "scene:skills" ? (
          <SkillsSceneLayout scene={scene} language={language} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : scene.id === "scene:security" ? (
          <SecuritySceneLayout scene={scene} language={language} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : scene.id === "scene:channels" ? (
          <ChannelsSceneLayout scene={scene} language={language} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : scene.id === "scene:remote_access" ? (
          <RemoteAccessSceneLayout scene={scene} language={language} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : scene.id === "scene:review" ? (
          <ReviewSceneLayout scene={scene} language={language} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : scene.id === "scene:done" ? (
          <DoneSceneLayout scene={scene} language={language} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        ) : (
          <GenericSceneLayout scene={scene} language={language} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        )}
      </div>

      <details className="border-t border-stone-200/80 bg-white/70 px-5 py-4 sm:px-6" data-setup-visual-outline={scene.id}>
        <summary className="cursor-pointer text-sm font-semibold text-stone-800">
          {t("텍스트 아웃라인", "Text outline")}
        </summary>
        <div className="mt-3 space-y-3 text-sm text-stone-700" id={outlineId}>
          <div className="leading-6">{scene.label}</div>
          <ul className="space-y-2 leading-6">
            {buildTextOutline(scene, language).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  )
}

function WelcomeSceneLayout({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}) {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)

  return (
    <div className="space-y-4">
      <div className="hidden items-stretch gap-3 overflow-x-auto pb-1 xl:flex">
        {scene.nodes.map((node, index) => (
          <React.Fragment key={node.id}>
            <VisualizationNodeCard
              node={node}
              language={language}
              selected={node.id === selectedNodeId}
              onSelect={onSelectNode}
              compact
            />
            {index < scene.nodes.length - 1 ? <FlowConnector label={t("다음", "Next")} /> : null}
          </React.Fragment>
        ))}
      </div>
      <div className="grid gap-3 xl:hidden">
        {scene.nodes.map((node, index) => (
          <React.Fragment key={node.id}>
            <VisualizationNodeCard
              node={node}
              language={language}
              selected={node.id === selectedNodeId}
              onSelect={onSelectNode}
            />
            {index < scene.nodes.length - 1 ? <VerticalConnector label={t("다음", "Next")} /> : null}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function PersonalSceneLayout({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}) {
  const nodeMap = new Map(scene.nodes.map((node) => [node.id, node]))
  const identity = nodeMap.get("node:personal:identity")
  const languageNode = nodeMap.get("node:personal:language")
  const timezoneNode = nodeMap.get("node:personal:timezone")
  const workspace = nodeMap.get("node:personal:workspace")
  const localContext = nodeMap.get("node:personal:local_context")
  const aiContext = nodeMap.get("node:personal:ai_context")
  const channelContext = nodeMap.get("node:personal:channel_context")

  return (
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.1fr_0.95fr]">
      <div className="space-y-4">
        {languageNode ? (
          <VisualizationNodeCard node={languageNode} language={language} selected={languageNode.id === selectedNodeId} onSelect={onSelectNode} />
        ) : null}
        {workspace ? (
          <VisualizationNodeCard node={workspace} language={language} selected={workspace.id === selectedNodeId} onSelect={onSelectNode} />
        ) : null}
      </div>

      <div className="space-y-4">
        {identity ? (
          <VisualizationNodeCard node={identity} language={language} selected={identity.id === selectedNodeId} onSelect={onSelectNode} large />
        ) : null}
        <ConnectorLabel text={pickUiText(language, "이 설정은 이후 AI/채널 흐름에 그대로 전달됩니다.", "These settings flow directly into later AI and channel behavior.")} />
        <div className="grid gap-4 md:grid-cols-2">
          {aiContext ? (
            <VisualizationNodeCard node={aiContext} language={language} selected={aiContext.id === selectedNodeId} onSelect={onSelectNode} compact />
          ) : null}
          {channelContext ? (
            <VisualizationNodeCard node={channelContext} language={language} selected={channelContext.id === selectedNodeId} onSelect={onSelectNode} compact />
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        {timezoneNode ? (
          <VisualizationNodeCard node={timezoneNode} language={language} selected={timezoneNode.id === selectedNodeId} onSelect={onSelectNode} />
        ) : null}
        {localContext ? (
          <VisualizationNodeCard node={localContext} language={language} selected={localContext.id === selectedNodeId} onSelect={onSelectNode} />
        ) : null}
      </div>
    </div>
  )
}

function AiBackendsSceneLayout({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}) {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const nodeMap = new Map(scene.nodes.map((node) => [node.id, node]))
  const router = nodeMap.get("node:ai:router")
  const backendNodes = scene.nodes.filter((node) => node.kind === "ai_backend")
  const activeNode = backendNodes.find((node) => node.badges.includes("active")) ?? null
  const standbyNodes = backendNodes.filter((node) => node !== activeNode)
  const selectedBackend = backendNodes.find((node) => node.id === selectedNodeId) ?? activeNode ?? backendNodes[0] ?? null

  return (
    <div className="grid gap-4 xl:grid-cols-[0.92fr_1.15fr_0.92fr]">
      <div className="space-y-4">
        <ConnectorLabel text={t("대기 중이거나 아직 준비되지 않은 연결", "Standby or not-yet-ready connections")} />
        {standbyNodes.length > 0 ? standbyNodes.map((node) => (
          <VisualizationNodeCard
            key={node.id}
            node={node}
            language={language}
            selected={node.id === selectedNodeId}
            onSelect={onSelectNode}
          />
        )) : (
          <VisualizationEmptyCard
            title={t("대기 연결 없음", "No standby connections")}
            description={t("현재는 활성 AI 또는 선택된 연결만 보입니다.", "Only the live AI or the selected connection is present right now.")}
          />
        )}
      </div>

      <div className="space-y-4">
        {router ? (
          <VisualizationNodeCard
            node={router}
            language={language}
            selected={router.id === selectedNodeId}
            onSelect={onSelectNode}
            large
          />
        ) : null}
        <ConnectorLabel text={t("단일 AI 정책은 한 번에 하나의 backend만 live 상태로 유지합니다.", "Single-AI policy keeps exactly one backend live at a time.")} />
        {activeNode ? (
          <VisualizationNodeCard
            node={activeNode}
            language={language}
            selected={activeNode.id === selectedNodeId}
            onSelect={onSelectNode}
            large={selectedBackend?.id === activeNode.id}
          />
        ) : (
          <VisualizationEmptyCard
            title={t("활성 AI 없음", "No active AI")}
            description={t("오른쪽 Inspector에서 backend 하나를 활성화하면 이 영역이 채워집니다.", "Enable one backend in the inspector to populate this area.")}
          />
        )}
      </div>

      <div className="space-y-4">
        <ConnectorLabel text={t("현재 선택된 backend", "Selected backend")} />
        {selectedBackend ? (
          <VisualizationNodeCard
            node={selectedBackend}
            language={language}
            selected
            onSelect={onSelectNode}
            large
          />
        ) : (
          <VisualizationEmptyCard
            title={t("선택된 backend 없음", "No backend selected")}
            description={t("왼쪽이나 가운데의 backend 노드를 눌러 Inspector와 연결합니다.", "Select a backend node to bind it to the inspector.")}
          />
        )}
      </div>
    </div>
  )
}

function AiRoutingSceneLayout({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}) {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const nodeMap = new Map(scene.nodes.map((node) => [node.id, node]))
  const profile = nodeMap.get("node:routing:profile")
  const router = nodeMap.get("node:routing:router")
  const targets = scene.nodes
    .filter((node) => node.kind === "ai_backend")
    .sort((left, right) => extractPriority(left.badges) - extractPriority(right.badges))

  return (
    <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
      <div className="space-y-4">
        {profile ? (
          <VisualizationNodeCard node={profile} language={language} selected={profile.id === selectedNodeId} onSelect={onSelectNode} />
        ) : null}
        <VerticalConnector label={t("입력", "Input")} />
        {router ? (
          <VisualizationNodeCard node={router} language={language} selected={router.id === selectedNodeId} onSelect={onSelectNode} large />
        ) : null}
        <ConnectorLabel text={t("이 장면은 list editor의 우선순위를 그대로 보여주는 projection입니다.", "This scene is a projection of the same priority order used by the list editor.")} />
      </div>

      <div className="space-y-3">
        {targets.length > 0 ? targets.map((node, index) => (
          <React.Fragment key={node.id}>
            <VisualizationNodeCard
              node={node}
              language={language}
              selected={node.id === selectedNodeId}
              onSelect={onSelectNode}
              large={node.id === selectedNodeId}
            />
            {index < targets.length - 1 ? <VerticalConnector label={t("다음 우선순위", "Next priority")} /> : null}
          </React.Fragment>
        )) : (
          <VisualizationEmptyCard
            title={t("라우팅 대상 없음", "No routing targets")}
            description={t("활성 AI를 선택하면 요청 흐름이 이 영역에 순서대로 표시됩니다.", "Selecting an active AI will populate this request flow area in order.")}
          />
        )}
      </div>
    </div>
  )
}

function McpSceneLayout({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}) {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const nodeMap = new Map(scene.nodes.map((node) => [node.id, node]))
  const hub = nodeMap.get("node:mcp:hub")
  const stdioNodes = getClusterNodes(scene, "cluster:mcp:stdio")
  const httpNodes = getClusterNodes(scene, "cluster:mcp:http")
  const serverNodes = scene.nodes.filter((node) => node.id.startsWith("node:mcp:") && node.id !== "node:mcp:hub" && node.id !== "node:mcp:placeholder")
  const selectedNode = serverNodes.find((node) => node.id === selectedNodeId) ?? serverNodes[0] ?? nodeMap.get("node:mcp:placeholder") ?? null

  return (
    <div className="grid gap-4 xl:grid-cols-[0.96fr_1.1fr_0.96fr]">
      <VisualizationClusterColumn
        title="stdio"
        description={t("직접 실행되는 로컬 MCP 서버", "Locally launched MCP servers")}
        nodes={stdioNodes}
        language={language}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        emptyTitle={t("stdio 서버 없음", "No stdio servers")}
        emptyDescription={t("새 MCP를 추가하면 이 cluster에 직접 실행형 서버가 표시됩니다.", "New direct-launch MCP servers will appear in this cluster.")}
      />

      <div className="space-y-4">
        {hub ? (
          <VisualizationNodeCard node={hub} language={language} selected={hub.id === selectedNodeId} onSelect={onSelectNode} large />
        ) : null}
        <ConnectorLabel text={t("도구 이름 목록은 graph가 아니라 Inspector에서 상세하게 확인합니다.", "Tool names stay in the inspector instead of the main graph.")} />
        {selectedNode ? (
          <VisualizationNodeCard node={selectedNode} language={language} selected onSelect={onSelectNode} large />
        ) : (
          <VisualizationEmptyCard
            title={t("선택된 MCP 서버 없음", "No MCP server selected")}
            description={t("좌우 cluster에서 서버 노드를 선택하면 Inspector가 같은 서버 편집으로 연결됩니다.", "Select a server node in either cluster to bind it to the inspector.")}
          />
        )}
      </div>

      <VisualizationClusterColumn
        title="http"
        description={t("엔드포인트 기반 MCP 서버", "Endpoint-based MCP servers")}
        nodes={httpNodes}
        language={language}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        emptyTitle={t("http 서버 없음", "No http servers")}
        emptyDescription={t("HTTP transport는 cluster로 분리되어 표시되며 readiness 경고가 같이 유지됩니다.", "HTTP transport is separated into its own cluster and keeps readiness warnings visible.")}
      />
    </div>
  )
}

function SkillsSceneLayout({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}) {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const nodeMap = new Map(scene.nodes.map((node) => [node.id, node]))
  const hub = nodeMap.get("node:skills:hub")
  const builtinNodes = getClusterNodes(scene, "cluster:skills:builtin")
  const localNodes = getClusterNodes(scene, "cluster:skills:local")
  const skillNodes = scene.nodes.filter((node) => node.id.startsWith("node:skills:") && node.id !== "node:skills:hub" && node.id !== "node:skills:placeholder")
  const selectedNode = skillNodes.find((node) => node.id === selectedNodeId) ?? localNodes[0] ?? builtinNodes[0] ?? nodeMap.get("node:skills:placeholder") ?? null

  return (
    <div className="grid gap-4 xl:grid-cols-[0.96fr_1.1fr_0.96fr]">
      <VisualizationClusterColumn
        title={pickUiText(language, "기본 Skill", "Built-in Skill")}
        description={t("경로 입력 없이 바로 사용할 수 있는 항목", "Entries that can be used without a local path")}
        nodes={builtinNodes}
        language={language}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        emptyTitle={t("기본 Skill 없음", "No built-in skills")}
        emptyDescription={t("기본 Skill은 별도 경로 없이 바로 ready 상태가 될 수 있습니다.", "Built-in skills can become ready without a local path.")}
      />

      <div className="space-y-4">
        {hub ? (
          <VisualizationNodeCard node={hub} language={language} selected={hub.id === selectedNodeId} onSelect={onSelectNode} large />
        ) : null}
        <ConnectorLabel text={t("로컬 path와 상세 설명은 graph가 아니라 Inspector에서만 노출합니다.", "Local paths and detailed descriptions stay in the inspector instead of the graph.")} />
        {selectedNode ? (
          <VisualizationNodeCard node={selectedNode} language={language} selected onSelect={onSelectNode} large />
        ) : (
          <VisualizationEmptyCard
            title={t("선택된 Skill 없음", "No skill selected")}
            description={t("cluster의 Skill 노드를 선택하면 Inspector가 같은 항목 편집으로 연결됩니다.", "Select a skill node from either cluster to bind it to the inspector.")}
          />
        )}
      </div>

      <VisualizationClusterColumn
        title={pickUiText(language, "로컬 Skill", "Local Skill")}
        description={t("경로 확인이 필요한 로컬 Skill", "Local skills that require path validation")}
        nodes={localNodes}
        language={language}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        emptyTitle={t("로컬 Skill 없음", "No local skills")}
        emptyDescription={t("로컬 Skill을 추가하면 path 검증 결과와 함께 이 cluster에 표시됩니다.", "Local skills will appear in this cluster together with path validation results.")}
      />
    </div>
  )
}

function SecuritySceneLayout({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}) {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const nodeMap = new Map(scene.nodes.map((node) => [node.id, node]))
  const safeZone = nodeMap.get("node:security:safe_zone")
  const approvalGate = nodeMap.get("node:security:approval_gate")
  const timeoutPolicy = nodeMap.get("node:security:timeout_policy")
  const delegationLimit = nodeMap.get("node:security:delegation_limit")
  const restrictedZone = nodeMap.get("node:security:restricted_zone")

  return (
    <div className="grid gap-4 xl:grid-cols-[0.92fr_1.1fr_0.92fr]">
      <div className="space-y-4">
        <ConnectorLabel text={t("승인과 deny fallback이 유지되면 이 구역이 안정 상태를 지킵니다.", "When approvals and deny fallback stay enabled, this zone remains stable.")} />
        {safeZone ? (
          <VisualizationNodeCard node={safeZone} language={language} selected={safeZone.id === selectedNodeId} onSelect={onSelectNode} large />
        ) : null}
      </div>

      <div className="space-y-4">
        {approvalGate ? (
          <VisualizationNodeCard node={approvalGate} language={language} selected={approvalGate.id === selectedNodeId} onSelect={onSelectNode} large />
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {timeoutPolicy ? (
            <VisualizationNodeCard node={timeoutPolicy} language={language} selected={timeoutPolicy.id === selectedNodeId} onSelect={onSelectNode} />
          ) : null}
          {delegationLimit ? (
            <VisualizationNodeCard node={delegationLimit} language={language} selected={delegationLimit.id === selectedNodeId} onSelect={onSelectNode} />
          ) : null}
        </div>
        <ConnectorLabel text={t("Timeout fallback와 delegation limit이 같이 바뀌면 제한 구역 위험도가 함께 달라집니다.", "Changing timeout fallback and the delegation limit shifts the restricted-zone risk together.")} />
      </div>

      <div className="space-y-4">
        <ConnectorLabel text={t("승인이 꺼지거나 allow fallback, unlimited delegation이 겹치면 이 구역이 즉시 경고 상태가 됩니다.", "If approvals are off or allow fallback or unlimited delegation stack up, this zone turns risky immediately.")} />
        {restrictedZone ? (
          <VisualizationNodeCard node={restrictedZone} language={language} selected={restrictedZone.id === selectedNodeId} onSelect={onSelectNode} large />
        ) : null}
      </div>
    </div>
  )
}

function ChannelsSceneLayout({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}) {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const nodeMap = new Map(scene.nodes.map((node) => [node.id, node]))
  const webui = nodeMap.get("node:channels:webui")
  const telegram = nodeMap.get("node:channels:telegram")
  const slack = nodeMap.get("node:channels:slack")
  const selectedNode = scene.nodes.find((node) => node.id === selectedNodeId)
    ?? telegram
    ?? slack
    ?? webui
    ?? null

  return (
    <div className="grid gap-4 xl:grid-cols-[0.96fr_1.1fr_0.96fr]">
      <div className="space-y-4">
        {telegram ? (
          <VisualizationNodeCard node={telegram} language={language} selected={telegram.id === selectedNodeId} onSelect={onSelectNode} />
        ) : null}
        <ConnectorLabel text={t("허용 사용자/그룹 ID는 policy badge로 남기고, 실제 연결 확인은 Inspector preflight panel에서 분리합니다.", "Allowed user and group IDs remain as policy badges, while actual connection checks stay in a separate inspector preflight panel.")} />
      </div>

      <div className="space-y-4">
        {webui ? (
          <VisualizationNodeCard node={webui} language={language} selected={webui.id === selectedNodeId} onSelect={onSelectNode} large />
        ) : null}
        <ConnectorLabel text={t("WebUI는 기본 루트 채널이며 저장 시 외부 메신저 런타임 재시작 경계가 여기서 갈라집니다.", "WebUI is the built-in root channel, and the external messenger runtime restart boundary branches here on save.")} />
        {selectedNode ? (
          <VisualizationNodeCard node={selectedNode} language={language} selected onSelect={onSelectNode} large />
        ) : (
          <VisualizationEmptyCard
            title={t("선택된 채널 없음", "No channel selected")}
            description={t("왼쪽이나 오른쪽 채널 노드를 선택하면 Inspector가 같은 채널 설정과 연결됩니다.", "Select a left or right channel node to bind the inspector to that channel.")}
          />
        )}
      </div>

      <div className="space-y-4">
        {slack ? (
          <VisualizationNodeCard node={slack} language={language} selected={slack.id === selectedNodeId} onSelect={onSelectNode} />
        ) : null}
        <ConnectorLabel text={t("Slack은 policy badge와 별도로 Socket Mode preflight를 확인해야 실제 대화 전달 상태를 구분할 수 있습니다.", "Slack requires Socket Mode preflight in addition to policy badges so you can separate policy state from actual delivery readiness.")} />
      </div>
    </div>
  )
}

function RemoteAccessSceneLayout({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}) {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const nodeMap = new Map(scene.nodes.map((node) => [node.id, node]))
  const endpoint = nodeMap.get("node:remote:endpoint")
  const authBoundary = nodeMap.get("node:remote:auth_boundary")
  const mqttBridge = nodeMap.get("node:remote:mqtt_bridge")
  const externalClients = nodeMap.get("node:remote:external_clients")

  return (
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.1fr_0.95fr]">
      <div className="space-y-4">
        {endpoint ? (
          <VisualizationNodeCard node={endpoint} language={language} selected={endpoint.id === selectedNodeId} onSelect={onSelectNode} />
        ) : null}
        {authBoundary ? (
          <VisualizationNodeCard node={authBoundary} language={language} selected={authBoundary.id === selectedNodeId} onSelect={onSelectNode} />
        ) : null}
      </div>

      <div className="space-y-4">
        {externalClients ? (
          <VisualizationNodeCard node={externalClients} language={language} selected={externalClients.id === selectedNodeId} onSelect={onSelectNode} large />
        ) : null}
        <ConnectorLabel text={t("Yeonjang은 related badge로만 남기고, 이 장면의 하위 노드로 내리지 않습니다.", "Yeonjang stays as a related badge instead of becoming a subordinate node in this scene.")} />
      </div>

      <div className="space-y-4">
        {mqttBridge ? (
          <VisualizationNodeCard node={mqttBridge} language={language} selected={mqttBridge.id === selectedNodeId} onSelect={onSelectNode} />
        ) : null}
        <ConnectorLabel text={t("MQTT bridge 상세 런타임은 settings/extensions 화면으로 link-out하고, setup에서는 boundary 편집만 유지합니다.", "Detailed MQTT runtime stays in settings/extensions, while setup keeps only boundary editing.")} />
      </div>
    </div>
  )
}

function ReviewSceneLayout({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}) {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const board = scene.nodes.find((node) => node.id === "node:review:board") ?? null
  const tiles = scene.nodes.filter((node) => node.id.startsWith("node:review:") && node.id !== "node:review:board")

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="space-y-4">
        {board ? (
          <VisualizationNodeCard node={board} language={language} selected={board.id === selectedNodeId} onSelect={onSelectNode} large />
        ) : null}
        <ConnectorLabel text={t("각 tile을 누르면 해당 step으로 돌아가 원인과 입력값을 바로 수정할 수 있습니다.", "Clicking a tile jumps back to its step so you can fix the cause immediately.")} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {tiles.map((node) => (
          <VisualizationNodeCard
            key={node.id}
            node={node}
            language={language}
            selected={node.id === selectedNodeId}
            onSelect={onSelectNode}
          />
        ))}
      </div>
    </div>
  )
}

function DoneSceneLayout({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}) {
  const t = (korean: string, english: string) => pickUiText(language, korean, english)
  const hub = scene.nodes.find((node) => node.id === "node:done:setup") ?? null
  const summaryNodes = scene.nodes.filter((node) => node.id !== "node:done:setup")
  const selectedNode = summaryNodes.find((node) => node.id === selectedNodeId) ?? summaryNodes[0] ?? null

  return (
    <div className="grid gap-4 xl:grid-cols-[0.96fr_1.05fr_0.96fr]">
      <div className="grid gap-4">
        {summaryNodes.slice(0, Math.ceil(summaryNodes.length / 2)).map((node) => (
          <VisualizationNodeCard
            key={node.id}
            node={node}
            language={language}
            selected={node.id === selectedNodeId}
            onSelect={onSelectNode}
          />
        ))}
      </div>
      <div className="space-y-4">
        {hub ? (
          <VisualizationNodeCard node={hub} language={language} selected={hub.id === selectedNodeId} onSelect={onSelectNode} large />
        ) : null}
        <ConnectorLabel text={t("상세 런타임 추적은 dashboard와 settings로 나누고, setup 완료 화면에는 현재 활성 구조만 남깁니다.", "Detailed runtime tracing stays in the dashboard and settings, while the setup completion view keeps only the active structure.")} />
        {selectedNode ? (
          <VisualizationNodeCard node={selectedNode} language={language} selected onSelect={onSelectNode} large />
        ) : null}
      </div>
      <div className="grid gap-4">
        {summaryNodes.slice(Math.ceil(summaryNodes.length / 2)).map((node) => (
          <VisualizationNodeCard
            key={node.id}
            node={node}
            language={language}
            selected={node.id === selectedNodeId}
            onSelect={onSelectNode}
          />
        ))}
      </div>
    </div>
  )
}

function GenericSceneLayout({
  scene,
  language,
  selectedNodeId,
  onSelectNode,
}: {
  scene: VisualizationScene
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {scene.nodes.map((node) => (
        <VisualizationNodeCard
          key={node.id}
          node={node}
          language={language}
          selected={node.id === selectedNodeId}
          onSelect={onSelectNode}
        />
      ))}
    </div>
  )
}

function VisualizationNodeCard({
  node,
  language,
  selected,
  onSelect,
  compact = false,
  large = false,
}: {
  node: VisualizationNode
  language: UiLanguage
  selected?: boolean
  onSelect?: (nodeId: string) => void
  compact?: boolean
  large?: boolean
}) {
  const clickable = typeof onSelect === "function"
  const overlayTones = node.overlayTones ?? []
  const dominantOverlayTone = overlayTones[0]
  const containerClass = `rounded-[1.5rem] border bg-white/90 text-left shadow-sm transition ${
    selected
      ? "border-stone-900 shadow-[0_18px_48px_rgba(15,23,42,0.12)]"
      : "border-stone-200 hover:border-stone-300"
  } ${overlayRingClass(dominantOverlayTone)} ${large ? "p-5" : compact ? "min-w-[180px] p-4" : "p-4"}`
  const ariaLabel = buildNodeAriaLabel(node, language)
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            {node.kind.replace(/_/g, " ")}
          </div>
          <div className={`mt-2 font-semibold text-stone-900 ${large ? "text-lg" : "text-sm"}`}>{node.label}</div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusBadgeClass(node.status)}`}>
          {statusLabel(node.status, language)}
        </span>
      </div>
      {node.description ? (
        <div className={`mt-3 text-stone-600 ${compact ? "text-xs leading-5" : "text-sm leading-6"}`}>{node.description}</div>
      ) : null}
      {overlayTones.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {overlayTones.map((tone) => (
            <span key={tone} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${overlayToneBadgeClass(tone)}`}>
              {overlayToneLabel(tone, language)}
            </span>
          ))}
        </div>
      ) : null}
      {node.overlayMessages?.length ? (
        <div className="mt-3 rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600">
          {node.overlayMessages[0]}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {node.badges.map((badge) => (
          <span key={badge} className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600">
            {badge}
          </span>
        ))}
      </div>
    </>
  )

  if (!clickable) {
    return (
      <div className={containerClass} data-setup-visual-node={node.id} aria-label={ariaLabel}>
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={containerClass}
      data-setup-visual-node={node.id}
      aria-label={ariaLabel}
      aria-pressed={selected}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(node.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect(node.id)
          return
        }

        if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return

        const buttons = Array.from(event.currentTarget.ownerDocument.querySelectorAll<HTMLElement>("[data-setup-visual-node]"))
        const currentIndex = buttons.findIndex((button) => button.getAttribute("data-setup-visual-node") === node.id)
        if (currentIndex < 0) return

        event.preventDefault()
        const nextIndex = event.key === "ArrowRight" || event.key === "ArrowDown"
          ? Math.min(buttons.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1)
        const nextButton = buttons[nextIndex]
        const nextNodeId = nextButton?.getAttribute("data-setup-visual-node")
        if (!nextNodeId) return
        onSelect(nextNodeId)
        nextButton.focus()
      }}
    >
      {content}
    </button>
  )
}

function FlowConnector({ label }: { label: string }) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center justify-center text-stone-400">
      <div className="h-[2px] w-full bg-stone-300" />
      <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em]">{label}</div>
    </div>
  )
}

function VerticalConnector({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pl-4 text-stone-400">
      <div className="h-8 w-[2px] bg-stone-300" />
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em]">{label}</div>
    </div>
  )
}

function ConnectorLabel({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white/70 px-4 py-3 text-xs leading-5 text-stone-500">
      {text}
    </div>
  )
}

function VisualizationEmptyCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-stone-300 bg-white/75 p-4">
      <div className="text-sm font-semibold text-stone-800">{title}</div>
      <div className="mt-2 text-sm leading-6 text-stone-500">{description}</div>
    </div>
  )
}

function VisualizationClusterColumn({
  title,
  description,
  nodes,
  language,
  selectedNodeId,
  onSelectNode,
  emptyTitle,
  emptyDescription,
}: {
  title: string
  description: string
  nodes: VisualizationNode[]
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
  emptyTitle: string
  emptyDescription: string
}) {
  const overlayTone = dominantNodeOverlayTone(nodes)
  const overlayMessage = nodes.flatMap((node) => node.overlayMessages ?? [])[0]

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border bg-white/80 px-4 py-3 ${overlayTone ? overlayRingClass(overlayTone).replace("ring-2 ", "").replace(" ring-inset", "") : "border-stone-200"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{title}</div>
          {overlayTone ? (
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${overlayToneBadgeClass(overlayTone)}`}>
              {overlayToneLabel(overlayTone, language)}
            </span>
          ) : null}
        </div>
        <div className="mt-2 text-sm leading-6 text-stone-600">{description}</div>
        {overlayMessage ? (
          <div className="mt-3 rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600">
            {overlayMessage}
          </div>
        ) : null}
      </div>
      {nodes.length > 0 ? nodes.map((node) => (
        <VisualizationNodeCard
          key={node.id}
          node={node}
          language={language}
          selected={node.id === selectedNodeId}
          onSelect={onSelectNode}
        />
      )) : (
        <VisualizationEmptyCard title={emptyTitle} description={emptyDescription} />
      )}
    </div>
  )
}

function getClusterNodes(scene: VisualizationScene, clusterId: string): VisualizationNode[] {
  const nodeIds = new Set(scene.clusters?.find((cluster) => cluster.id === clusterId)?.nodeIds ?? [])
  return scene.nodes.filter((node) => nodeIds.has(node.id))
}

function extractPriority(badges: string[]): number {
  const value = badges.find((badge) => badge.startsWith("priority:"))
  if (!value) return Number.MAX_SAFE_INTEGER
  const parsed = Number.parseInt(value.slice("priority:".length), 10)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

function statusLabel(status: VisualizationStatus, language: UiLanguage): string {
  switch (status) {
    case "ready":
      return pickUiText(language, "준비됨", "Ready")
    case "warning":
      return pickUiText(language, "주의", "Warning")
    case "error":
      return pickUiText(language, "오류", "Error")
    case "disabled":
      return pickUiText(language, "비활성", "Disabled")
    case "draft":
      return pickUiText(language, "초안", "Draft")
    case "required":
      return pickUiText(language, "필수", "Required")
    case "planned":
    default:
      return pickUiText(language, "예정", "Planned")
  }
}

function statusBadgeClass(status: VisualizationStatus): string {
  switch (status) {
    case "ready":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "warning":
    case "required":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "error":
      return "border-red-200 bg-red-50 text-red-700"
    case "disabled":
      return "border-stone-200 bg-stone-100 text-stone-600"
    case "draft":
      return "border-sky-200 bg-sky-50 text-sky-700"
    case "planned":
    default:
      return "border-slate-200 bg-slate-50 text-slate-600"
  }
}

function statusDotClass(status: VisualizationStatus): string {
  switch (status) {
    case "ready":
      return "bg-emerald-500"
    case "warning":
    case "required":
      return "bg-amber-500"
    case "error":
      return "bg-red-500"
    case "disabled":
      return "bg-stone-400"
    case "draft":
      return "bg-sky-500"
    case "planned":
    default:
      return "bg-slate-400"
  }
}

function alertClass(tone: "info" | "warning" | "error"): string {
  switch (tone) {
    case "error":
      return "border-red-200 bg-red-50 text-red-700"
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "info":
    default:
      return "border-blue-200 bg-blue-50 text-blue-700"
  }
}

function alertDotClass(tone: "info" | "warning" | "error"): string {
  switch (tone) {
    case "error":
      return "bg-red-500"
    case "warning":
      return "bg-amber-500"
    case "info":
    default:
      return "bg-blue-500"
  }
}

function overlayRingClass(tone?: VisualizationOverlayTone): string {
  switch (tone) {
    case "error":
      return "ring-2 ring-red-300 ring-inset"
    case "required":
      return "ring-2 ring-amber-300 ring-inset"
    case "warning":
    case "blocked-next-step":
      return "ring-2 ring-orange-300 ring-inset"
    case "draft-changed":
      return "ring-2 ring-sky-300 ring-inset"
    default:
      return ""
  }
}

function overlayToneBadgeClass(tone: VisualizationOverlayTone): string {
  switch (tone) {
    case "error":
      return "border-red-200 bg-red-50 text-red-700"
    case "required":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "warning":
      return "border-orange-200 bg-orange-50 text-orange-700"
    case "blocked-next-step":
      return "border-rose-200 bg-rose-50 text-rose-700"
    case "draft-changed":
    default:
      return "border-sky-200 bg-sky-50 text-sky-700"
  }
}

function overlayToneLabel(tone: VisualizationOverlayTone, language: UiLanguage): string {
  switch (tone) {
    case "error":
      return pickUiText(language, "오류 overlay", "Error overlay")
    case "required":
      return pickUiText(language, "필수 overlay", "Required overlay")
    case "warning":
      return pickUiText(language, "주의 overlay", "Warning overlay")
    case "blocked-next-step":
      return pickUiText(language, "다음 단계 차단", "Next step blocked")
    case "draft-changed":
    default:
      return pickUiText(language, "초안 변경", "Draft changed")
  }
}

function buildNodeAriaLabel(node: VisualizationNode, language: UiLanguage): string {
  const parts = [
    node.label,
    statusLabel(node.status, language),
    ...(node.overlayTones?.map((tone) => overlayToneLabel(tone, language)) ?? []),
    ...(node.badges.length > 0 ? [node.badges.join(", ")] : []),
  ]
  return parts.join(" | ")
}

function dominantNodeOverlayTone(nodes: VisualizationNode[]): VisualizationOverlayTone | undefined {
  const tones = nodes.flatMap((node) => node.overlayTones ?? [])
  if (tones.includes("error")) return "error"
  if (tones.includes("required")) return "required"
  if (tones.includes("blocked-next-step")) return "blocked-next-step"
  if (tones.includes("warning")) return "warning"
  if (tones.includes("draft-changed")) return "draft-changed"
  return undefined
}

function buildTextOutline(scene: VisualizationScene, language: UiLanguage): string[] {
  const lines = scene.nodes.map((node) => {
    const badges = node.badges.length > 0 ? ` (${node.badges.join(", ")})` : ""
    const overlays = node.overlayTones?.length ? ` [${node.overlayTones.map((tone) => overlayToneLabel(tone, language)).join(", ")}]` : ""
    return `${node.label}: ${statusLabel(node.status, language)}${badges}${overlays}`
  })

  const alertLines = (scene.alerts ?? []).map((alert) => `${pickUiText(language, "알림", "Alert")}: ${alert.message}`)
  const edgeLines = scene.edges
    .filter((edge) => edge.status === "warning" || edge.status === "error")
    .map((edge) => `${pickUiText(language, "흐름", "Flow")}: ${describeEdge(edge, scene, language)}`)

  return [...lines, ...alertLines, ...edgeLines]
}

function describeEdge(edge: VisualizationScene["edges"][number], scene: VisualizationScene, language: UiLanguage): string {
  const from = scene.nodes.find((node) => node.id === edge.from)?.label ?? edge.from
  const to = scene.nodes.find((node) => node.id === edge.to)?.label ?? edge.to
  const tone = edge.status === "error"
    ? pickUiText(language, "오류", "Error")
    : pickUiText(language, "주의", "Warning")
  return edge.label?.trim()
    ? `${from} -> ${to} (${edge.label}, ${tone})`
    : `${from} -> ${to} (${tone})`
}
