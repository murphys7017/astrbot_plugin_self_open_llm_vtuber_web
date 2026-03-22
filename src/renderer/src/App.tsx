/* eslint-disable no-shadow */
// import { StrictMode } from 'react';
import { Box, Flex, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { useState, useEffect, useRef, memo } from "react";
// import Canvas from './components/canvas/canvas'; // Likely unused now
import Sidebar from "./components/sidebar/sidebar";
import Footer from "./components/footer/footer";
import { AiStateProvider } from "./context/ai-state-context";
import { Live2DConfigProvider } from "./context/live2d-config-context";
import { SubtitleProvider } from "./context/subtitle-context";
import { BgUrlProvider } from "./context/bgurl-context";
import { layoutStyles } from "./layout";
import WebSocketHandler from "./services/websocket-handler";
import { CameraProvider } from "./context/camera-context";
import { ChatHistoryProvider } from "./context/chat-history-context";
import { CharacterConfigProvider } from "./context/character-config-context";
import { Toaster } from "./components/ui/toaster";
import { VADProvider } from "./context/vad-context";
import { Live2D } from "./components/canvas/live2d";
import TitleBar from "./components/electron/title-bar";
import { InputSubtitle } from "./components/electron/input-subtitle";
import { ProactiveSpeakProvider } from "./context/proactive-speak-context";
import { ScreenCaptureProvider } from "./context/screen-capture-context";
import { BrowserProvider } from "./context/browser-context";
// eslint-disable-next-line import/no-extraneous-dependencies, import/newline-after-import
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import Background from "./components/canvas/background";
import WebSocketStatus from "./components/canvas/ws-status";
import Subtitle from "./components/canvas/subtitle";
import { ModeProvider, useMode } from "./context/mode-context";
import { PetOverlayWindow } from "./components/electron/pet-overlay-window";
import { usePetOverlayBridge } from "./hooks/utils/use-pet-overlay-bridge";

const isPetOverlayRenderer = (): boolean => {
  try {
    return new URLSearchParams(window.location.search).get("petOverlay") === "1";
  } catch (_error) {
    return false;
  }
};

// 【P1 修复】低频提供者组件 - 用 React.memo 包装防止不必要重新渲染
// 这些提供者的状态变化不频繁，不应该因为高频提供者的变化而重新渲染
const LowFrequencyProviders = memo(function LowFrequencyProviders({ children }: { children: React.ReactNode }) {
  return (
    <CameraProvider>
      <ScreenCaptureProvider>
        <CharacterConfigProvider>
          <BgUrlProvider>
            <BrowserProvider>
              {children}
            </BrowserProvider>
          </BgUrlProvider>
        </CharacterConfigProvider>
      </ScreenCaptureProvider>
    </CameraProvider>
  );
});

function AppContent(): JSX.Element {
  const [showSidebar, setShowSidebar] = useState(true);
  const [isFooterCollapsed, setIsFooterCollapsed] = useState(false);
  const { mode } = useMode();
  const isElectron = window.api !== undefined;
  const live2dContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty("--vh", `${vh}px`);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    const prevHtml = {
      overflow: html.style.overflow,
      height: html.style.height,
      position: html.style.position,
      width: html.style.width,
    };
    const prevBody = {
      overflow: body.style.overflow,
      height: body.style.height,
      position: body.style.position,
      width: body.style.width,
    };

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    html.style.height = '100%';
    body.style.height = '100%';
    html.style.position = 'fixed';
    body.style.position = 'fixed';
    html.style.width = '100%';
    body.style.width = '100%';

    return () => {
      html.style.overflow = prevHtml.overflow;
      html.style.height = prevHtml.height;
      html.style.position = prevHtml.position;
      html.style.width = prevHtml.width;
      body.style.overflow = prevBody.overflow;
      body.style.height = prevBody.height;
      body.style.position = prevBody.position;
      body.style.width = prevBody.width;
    };
  }, []);

  // Define base style properties shared across modes/breakpoints
  const live2dBaseStyle = {
    position: "absolute" as const,
    overflow: "hidden",
    transition: "all 0.3s ease-in-out", // Optional transition
    pointerEvents: "auto" as const,
  };

  // Define styles specifically for the "window" mode, using responsive syntax
  const getResponsiveLive2DWindowStyle = (sidebarVisible: boolean) => ({
    ...live2dBaseStyle,
    top: isElectron ? "30px" : "0px",
    height: `calc(100% - ${isElectron ? "30px" : "0px"})`,
    zIndex: 5, // Ensure it's layered correctly below UI but above background
    left: {
      base: "0px", // Column layout (base): Start from left edge
      md: sidebarVisible ? "440px" : "24px", // Row layout (md+): Offset by sidebar width
    },
    width: {
      base: "100%", // Column layout (base): Full width
      md: `calc(100% - ${sidebarVisible ? "440px" : "24px"})`, // Row layout (md+): Adjust width based on sidebar
    },
  });

  // Define styles specifically for the "pet" mode
  const live2dPetStyle = {
    ...live2dBaseStyle,
    top: 0, // Override position for pet mode
    left: 0,
    width: "100vw", // Full viewport
    height: "100vh",
    zIndex: 15, // Higher zIndex for pet mode overlay
  };

  return (
    <>
      <Box
        ref={live2dContainerRef}
        // Apply styles conditionally based on mode
        // Use the function to get dynamic responsive styles for window mode
        {...(mode === "window"
          ? getResponsiveLive2DWindowStyle(showSidebar)
          : live2dPetStyle)}
      >
        <Live2D />
      </Box>

      {/* Conditional Rendering of Window UI */}
      {mode === "window" && (
        <>
          {isElectron && <TitleBar />}
          {/* Apply styles by spreading */}
          <Flex {...layoutStyles.appContainer}>
            <Box
              {...layoutStyles.sidebar}
              {...(!showSidebar && { width: "24px" })}
            >
              <Sidebar
                isCollapsed={!showSidebar}
                onToggle={() => setShowSidebar(!showSidebar)}
              />
            </Box>
            <Box {...layoutStyles.mainContent}>
              <Background />
              <Box position="absolute" top="20px" left="20px" zIndex={10}>
                <WebSocketStatus />
              </Box>
              <Box
                position="absolute"
                bottom={isFooterCollapsed ? "39px" : "135px"}
                left="50%"
                transform="translateX(-50%)"
                zIndex={10}
                width="60%"
              >
                <Subtitle />
              </Box>
              <Box
                {...layoutStyles.footer}
                zIndex={10}
                {...(isFooterCollapsed && layoutStyles.collapsedFooter)}
              >
                <Footer
                  isCollapsed={isFooterCollapsed}
                  onToggle={() => setIsFooterCollapsed(!isFooterCollapsed)}
                />
              </Box>
            </Box>
          </Flex>
        </>
      )}

      {/* Conditional Rendering of Pet Mode UI */}
      {mode === "pet" && !isElectron && <InputSubtitle />}
    </>
  );
}

function App(): JSX.Element {
  if (isPetOverlayRenderer()) {
    return (
      <ChakraProvider value={defaultSystem}>
        <PetOverlayWindow />
      </ChakraProvider>
    );
  }

  return (
    <ChakraProvider value={defaultSystem}>
      {/* ModeProvider needs to wrap AppContent to provide mode to getGlobalStyles */}
      <ModeProvider>
        <AppWithGlobalStyles />
      </ModeProvider>
    </ChakraProvider>
  );
}

// New component to access mode for global styles
function AppWithGlobalStyles(): JSX.Element {
  return (
    <>
      {/* 【P1 修复】低频提供者在外层（用 memo 保护） */}
      <LowFrequencyProviders>
        {/* 【P1 修复】高频提供者在内层（使用 useMemo 进一步优化） */}
        <ChatHistoryProvider>
          <AiStateProvider>
            <ProactiveSpeakProvider>
              <Live2DConfigProvider>
                <SubtitleProvider>
                  <VADProvider>
                    <WebSocketHandler>
                      <PetOverlayBridge />
                      <Toaster />
                      <AppContent />
                    </WebSocketHandler>
                  </VADProvider>
                </SubtitleProvider>
              </Live2DConfigProvider>
            </ProactiveSpeakProvider>
          </AiStateProvider>
        </ChatHistoryProvider>
      </LowFrequencyProviders>
    </>
  );
}

function PetOverlayBridge(): null {
  usePetOverlayBridge();
  return null;
}

export default App;
