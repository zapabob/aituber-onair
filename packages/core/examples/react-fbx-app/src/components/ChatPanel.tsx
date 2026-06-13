import type { AvatarEmotion } from '../types/avatar';
import type { ChatMessage } from '../types/chat';
import { AvatarBackground } from './AvatarPanel';
import { ChatLog } from './ChatLog';
import { ChatInput } from './ChatInput';

interface ChatPanelProps {
  messages: ChatMessage[];
  partialResponse: string;
  isProcessing: boolean;
  onSend: (text: string) => void;
  onToggleSettings: () => void;
  mouthLevel: number;
  isSpeaking: boolean;
  activeEmotion: AvatarEmotion;
  backgroundImageUrl?: string | null;
}

export function ChatPanel({
  messages,
  partialResponse,
  isProcessing,
  onSend,
  onToggleSettings,
  mouthLevel,
  isSpeaking,
  activeEmotion,
  backgroundImageUrl,
}: ChatPanelProps) {
  const panelStyle = backgroundImageUrl
    ? {
        backgroundImage: `url(${backgroundImageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined;

  return (
    <div className="chat-panel" style={panelStyle}>
      <button
        type="button"
        className="settings-button chat-settings-button"
        onClick={onToggleSettings}
        aria-label="Settings"
      >
        ⚙
      </button>
      <AvatarBackground
        mouthLevel={mouthLevel}
        isSpeaking={isSpeaking}
        activeEmotion={activeEmotion}
      />
      <ChatLog messages={messages} partialResponse={partialResponse} />
      <ChatInput onSend={onSend} disabled={isProcessing} />
    </div>
  );
}
