import {
  Box,
  Button,
  Flex,
  HStack,
  IconButton,
  Input,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LuHand, LuMic, LuMicOff, LuSend,
} from 'react-icons/lu';

export function PetOverlayWindow(): JSX.Element {
  const [inputValue, setInputValue] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [aiState, setAiState] = useState('idle');
  const [lastAIMessage, setLastAIMessage] = useState('');
  const [micOn, setMicOn] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastReportedHeightRef = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const cleanup = window.api?.onPetOverlayState?.((state) => {
      setAiState(state.aiState || 'idle');
      setLastAIMessage(state.lastAIMessage || '');
      setMicOn(Boolean(state.micOn));
    });

    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    const prevHtml = {
      overflow: html.style.overflow,
      width: html.style.width,
      height: html.style.height,
      margin: html.style.margin,
      padding: html.style.padding,
    };
    const prevBody = {
      overflow: body.style.overflow,
      width: body.style.width,
      height: body.style.height,
      margin: body.style.margin,
      padding: body.style.padding,
    };
    const prevRoot = root ? {
      overflow: root.style.overflow,
      width: root.style.width,
      height: root.style.height,
      margin: root.style.margin,
      padding: root.style.padding,
    } : null;

    html.style.overflow = 'hidden';
    html.style.width = '100%';
    html.style.height = '100%';
    html.style.margin = '0';
    html.style.padding = '0';

    body.style.overflow = 'hidden';
    body.style.width = '100%';
    body.style.height = '100%';
    body.style.margin = '0';
    body.style.padding = '0';

    if (root) {
      root.style.overflow = 'hidden';
      root.style.width = '100%';
      root.style.height = '100%';
      root.style.margin = '0';
      root.style.padding = '0';
    }

    return () => {
      html.style.overflow = prevHtml.overflow;
      html.style.width = prevHtml.width;
      html.style.height = prevHtml.height;
      html.style.margin = prevHtml.margin;
      html.style.padding = prevHtml.padding;

      body.style.overflow = prevBody.overflow;
      body.style.width = prevBody.width;
      body.style.height = prevBody.height;
      body.style.margin = prevBody.margin;
      body.style.padding = prevBody.padding;

      if (root && prevRoot) {
        root.style.overflow = prevRoot.overflow;
        root.style.width = prevRoot.width;
        root.style.height = prevRoot.height;
        root.style.margin = prevRoot.margin;
        root.style.padding = prevRoot.padding;
      }
    };
  }, []);

  const sendText = useCallback(() => {
    const currentValue = inputRef.current?.value ?? inputValue;
    const text = currentValue.trim();
    if (!text) return;
    window.api?.sendPetOverlayText?.({
      text,
      timestamp: Date.now(),
    });
    setInputValue('');
  }, [inputValue]);

  const ensureMicPermission = useCallback(async () => {
    if (micOn) return true;
    if (!navigator.mediaDevices?.getUserMedia) return true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      console.warn('[PetOverlay] Failed to request microphone permission:', error);
      return false;
    }
  }, [micOn]);

  const handleMicToggleClick = useCallback(async () => {
    if (!micOn) {
      const granted = await ensureMicPermission();
      if (!granted) return;
    }
    window.api?.sendPetOverlayMicToggle?.();
  }, [micOn, ensureMicPermission]);

  useEffect(() => {
    if (!window.api?.setPetOverlayPreferredHeight) return undefined;

    const rafId = requestAnimationFrame(() => {
      if (!contentRef.current) return;
      const preferredHeight = Math.round(contentRef.current.scrollHeight + 20);
      if (Math.abs(preferredHeight - lastReportedHeightRef.current) < 3) return;
      lastReportedHeightRef.current = preferredHeight;
      window.api?.setPetOverlayPreferredHeight?.(preferredHeight);
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [lastAIMessage, aiState, micOn]);

  return (
    <Box
      width="100%"
      height="100%"
      boxSizing="border-box"
      overflow="hidden"
      bg="rgba(8, 8, 8, 0.76)"
      borderRadius="12px"
      border="1px solid rgba(255, 255, 255, 0.15)"
      boxShadow="0 18px 40px rgba(0, 0, 0, 0.4)"
      p="10px"
      userSelect="none"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <Stack
        ref={contentRef}
        gap="8px"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        <Box
          height="14px"
          borderRadius="8px"
          bg="whiteAlpha.200"
          opacity={0.6}
          style={{ WebkitAppRegion: 'drag' } as any}
        />
        {lastAIMessage ? (
          <Box color="white" px="4px">
            <Text fontSize="sm" lineHeight="1.45" lineClamp={4}>
              {lastAIMessage}
            </Text>
          </Box>
        ) : (
          <Box color="whiteAlpha.700" px="4px">
            <Text fontSize="sm">...</Text>
          </Box>
        )}

        <Flex justify="space-between" align="center" color="whiteAlpha.800" px="4px">
          <Text fontSize="xs">{aiState}</Text>
          <HStack gap="6px">
            <IconButton
              aria-label="Toggle microphone"
              size="xs"
              variant="ghost"
              color="whiteAlpha.900"
              onClick={() => {
                void handleMicToggleClick();
              }}
            >
              {micOn ? <LuMic size={14} /> : <LuMicOff size={14} />}
            </IconButton>
            <IconButton
              aria-label="Interrupt"
              size="xs"
              variant="ghost"
              color="whiteAlpha.900"
              onClick={() => window.api?.sendPetOverlayInterrupt?.()}
            >
              <LuHand size={14} />
            </IconButton>
          </HStack>
        </Flex>

        <HStack gap="8px">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={(e) => {
              if (isComposing || (e.nativeEvent as any)?.isComposing) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendText();
              }
            }}
            placeholder="Type your message..."
            bg="blackAlpha.500"
            color="white"
            borderColor="whiteAlpha.300"
            _placeholder={{ color: 'whiteAlpha.600' }}
            _focus={{ borderColor: 'whiteAlpha.600' }}
            size="sm"
          />
          <Button
            onClick={sendText}
            size="sm"
            bg="whiteAlpha.200"
            color="whiteAlpha.900"
            _hover={{ bg: 'whiteAlpha.300' }}
          >
            <LuSend size={15} />
          </Button>
        </HStack>
      </Stack>
    </Box>
  );
}
