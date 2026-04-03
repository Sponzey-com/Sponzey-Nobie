import { useEffect, useState } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { connectWs, onWsConnect, onWsMessage } from "./api/ws"
import { Layout } from "./components/Layout"
import { useUiI18n } from "./lib/ui-i18n"
import { AuditPage } from "./pages/AuditPage"
import { ChatPage } from "./pages/ChatPage"
import { DashboardPage } from "./pages/DashboardPage"
import { LoginPage } from "./pages/LoginPage"
import PluginsPage from "./pages/PluginsPage"
import { RunsPage } from "./pages/RunsPage"
import { SchedulePage } from "./pages/SchedulePage"
import { SettingsPage } from "./pages/SettingsPage"
import { SetupPage } from "./pages/SetupPage"
import { handleWsMessage, useChatStore } from "./stores/chat"
import { useCapabilitiesStore } from "./stores/capabilities"
import { useConnectionStore } from "./stores/connection"
import { useRunsStore } from "./stores/runs"
import { useSetupStore } from "./stores/setup"

export default function App() {
  const { text } = useUiI18n()
  const setConnected = useChatStore((state) => state.setConnected)
  const initializeConnection = useConnectionStore((state) => state.initialize)
  const initializeCapabilities = useCapabilitiesStore((state) => state.initialize)
  const ensureRunsInitialized = useRunsStore((state) => state.ensureInitialized)
  const setupCompleted = useSetupStore((state) => state.state.completed)
  const initializeSetup = useSetupStore((state) => state.initialize)
  const setupInitialized = useSetupStore((state) => state.initialized)
  const [authState, setAuthState] = useState<boolean | null>(null)

  useEffect(() => {
    ensureRunsInitialized()
  }, [ensureRunsInitialized])

  useEffect(() => {
    void initializeConnection()
    void initializeCapabilities()
    void initializeSetup()
  }, [initializeCapabilities, initializeConnection, initializeSetup])

  useEffect(() => {
    void checkAuth()
  }, [])

  async function checkAuth() {
    try {
      const response = await fetch("/api/status")
      if (response.ok) {
        setAuthState(true)
        initWs()
      } else if (response.status === 401) {
        setAuthState(false)
      } else {
        setAuthState(true)
        initWs()
      }
    } catch {
      setAuthState(true)
      initWs()
    }
  }

  function initWs() {
    connectWs()
    onWsMessage(handleWsMessage)
    onWsConnect((connected) => {
      setConnected(connected)
      if (connected) {
        void ensureRunsInitialized(true)
      }
    })
  }

  function handleLogin(token: string) {
    void token
    setAuthState(true)
    initWs()
  }

  if (authState === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 text-sm text-stone-500">
        {text("연결 중...", "Connecting...")}
      </div>
    )
  }

  if (authState === false) {
    return <LoginPage onLogin={handleLogin} />
  }

  if (!setupInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 text-sm text-stone-500">
        {text("setup 상태를 불러오는 중...", "Loading setup state...")}
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to={setupCompleted ? "/chat" : "/settings"} replace />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/chat" element={setupCompleted ? <ChatPage /> : <Navigate to="/settings" replace />} />
          <Route path="/runs" element={setupCompleted ? <RunsPage /> : <Navigate to="/settings" replace />} />
          <Route path="/dashboard" element={setupCompleted ? <DashboardPage /> : <Navigate to="/settings" replace />} />
          <Route path="/audit" element={setupCompleted ? <AuditPage /> : <Navigate to="/settings" replace />} />
          <Route path="/schedules" element={setupCompleted ? <SchedulePage /> : <Navigate to="/settings" replace />} />
          <Route path="/plugins" element={setupCompleted ? <PluginsPage /> : <Navigate to="/settings" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
          <Route path="*" element={<Navigate to={setupCompleted ? "/chat" : "/settings"} replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
