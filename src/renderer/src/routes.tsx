import { FiHome, FiFeather, FiSettings, FiMic } from 'react-icons/fi'
import { LuCombine } from 'react-icons/lu'
import { HiOutlineChatAlt2 } from 'react-icons/hi'
import { BsLayoutWtf } from 'react-icons/bs'
import HomePage from './pages/HomePage/HomePage'
import SettingPage from './pages/SettingPage/SettingPage'
import StepFunctionsGeneratorPage from './pages/StepFunctionsGeneratorPage/StepFunctionsGeneratorPage'
import WebsiteGeneratorPage from './pages/WebsiteGeneratorPage/WebsiteGeneratorPage'
import ChatPage from './pages/ChatPage/ChatPage'
import DiagramGeneratorPage from './pages/DiagramGeneratorPage/DiagramGeneratorPage'
import { AgentDirectoryPage } from './pages/AgentDirectoryPage/AgentDirectoryPage'
import BackgroundAgentPage from './pages/BackgroundAgentPage/BackgroundAgentPage'
import TaskExecutionHistoryPage from './pages/BackgroundAgentPage/TaskExecutionHistoryPage'
import SpeakPage from './pages/SpeakPage'
import { LuBookDown } from 'react-icons/lu'
import { PiPulse } from 'react-icons/pi'

export const routes = [
  {
    name: 'Home',
    href: '/',
    icon: FiHome,
    position: 'top',
    element: <HomePage />
  },
  {
    name: 'Chat',
    href: '/chat',
    icon: HiOutlineChatAlt2,
    position: 'top',
    element: <ChatPage />
  },
  {
    name: 'Voice Chat',
    href: '/speak',
    icon: FiMic,
    position: 'top',
    element: <SpeakPage />
  },
  {
    name: 'Agent Directory',
    href: '/agent-directory',
    icon: LuBookDown,
    position: 'top',
    element: <AgentDirectoryPage />
  },
  {
    name: 'Background Agent',
    href: '/background-agent',
    icon: PiPulse,
    position: 'top',
    element: <BackgroundAgentPage />
  },
  {
    name: 'Website Generator',
    href: '/generative-ui',
    icon: FiFeather,
    position: 'top',
    element: <WebsiteGeneratorPage />
  },
  {
    name: 'Step Functions Generator',
    href: '/step-functions-generator',
    icon: LuCombine,
    position: 'top',
    element: <StepFunctionsGeneratorPage />
  },
  {
    name: 'Diagram Generator',
    href: '/diagram-generator',
    icon: BsLayoutWtf,
    position: 'top',
    element: <DiagramGeneratorPage />
  },
  {
    name: 'Setting',
    href: '/setting',
    icon: FiSettings,
    position: 'top',
    element: <SettingPage />
  },
  {
    name: 'Task History',
    href: '/background-agent/task-history/:taskId',
    icon: PiPulse,
    position: 'hidden', // Hidden from navigation menu
    element: <TaskExecutionHistoryPage />
  }
  // for debug
  // {
  //   name: 'Error',
  //   href: '/error',
  //   icon: FiSettings,
  //   position: 'top',
  //   element: <ErrorPage />
  // }
]
