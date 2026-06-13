export type AvatarEmotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'relaxed';

export const DEFAULT_AVATAR_EMOTION: AvatarEmotion = 'neutral';

export function normalizeAvatarEmotion(value: unknown): AvatarEmotion {
  if (typeof value !== 'string') {
    return DEFAULT_AVATAR_EMOTION;
  }

  switch (value.toLowerCase()) {
    case 'happy':
    case 'sad':
    case 'angry':
    case 'surprised':
    case 'relaxed':
    case 'neutral':
      return value.toLowerCase() as AvatarEmotion;
    default:
      return DEFAULT_AVATAR_EMOTION;
  }
}
