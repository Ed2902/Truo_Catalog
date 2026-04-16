const CONTROL_CHARACTERS_REGEX = /[\u0000-\u001F\u007F-\u009F]/g;
const HTML_TAG_REGEX = /<[^>]*>/g;
const ANGLE_BRACKET_REGEX = /[<>]/g;
const JAVASCRIPT_PROTOCOL_REGEX = /javascript:/gi;
const DATA_HTML_PROTOCOL_REGEX = /data:text\/html/gi;
const INLINE_EVENT_HANDLER_REGEX = /\bon[a-z]+\s*=/gi;
const MULTIPLE_SPACES_REGEX = /[ \t\f\v]+/g;
const MULTIPLE_NEWLINES_REGEX = /\n{3,}/g;

type SanitizePlainTextOptions = {
  preserveNewLines?: boolean;
};

export function sanitizePlainText(
  value?: string | null,
  options?: SanitizePlainTextOptions,
) {
  const preserveNewLines = options?.preserveNewLines ?? false;
  const normalized = (value ?? '').replace(/\r\n/g, '\n').normalize('NFKC');

  const sanitized = normalized
    .replace(CONTROL_CHARACTERS_REGEX, ' ')
    .replace(HTML_TAG_REGEX, ' ')
    .replace(ANGLE_BRACKET_REGEX, ' ')
    .replace(JAVASCRIPT_PROTOCOL_REGEX, ' ')
    .replace(DATA_HTML_PROTOCOL_REGEX, ' ')
    .replace(INLINE_EVENT_HANDLER_REGEX, ' ');

  if (!preserveNewLines) {
    return sanitized.replace(/\s+/g, ' ').trim();
  }

  return sanitized
    .split('\n')
    .map((line) => line.replace(MULTIPLE_SPACES_REGEX, ' ').trim())
    .join('\n')
    .replace(MULTIPLE_NEWLINES_REGEX, '\n\n')
    .trim();
}
