const buildOffset = (rawOffset: string): string => {
  if (rawOffset === 'GMT' || rawOffset === 'UTC') {
    return '+00:00';
  }

  const normalizedOffset = rawOffset.replace('GMT', '').replace('UTC', '');
  const match = normalizedOffset.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);

  if (!match) {
    return '+00:00';
  }

  const [, sign, hours, minutes] = match;
  return `${sign}${hours.padStart(2, '0')}:${(minutes ?? '00').padStart(2, '0')}`;
};

export const isValidIanaTimeZone = (timeZone: string): boolean => {
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

export const formatDateForTimeZone = (date: Date, timeZone: string): string => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  });

  const parts = formatter.formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));

  return `${valueByType.get('year')}-${valueByType.get('month')}-${valueByType.get('day')}T${valueByType.get('hour')}:${valueByType.get('minute')}:${valueByType.get('second')}${buildOffset(valueByType.get('timeZoneName') ?? 'UTC')}`;
};
