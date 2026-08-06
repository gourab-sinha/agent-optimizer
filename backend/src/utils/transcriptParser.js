/**
 * Transcript Parser Utility
 * Parses raw transcripts from HighLevel into structured conversation turns
 */

/**
 * Parse a raw transcript string into individual conversation turns
 *
 * HighLevel transcript format:
 * bot:This is the agent speaking
 * human:This is the caller speaking
 *
 * @param {string} rawTranscript - Raw transcript from HighLevel
 * @returns {Array<Object>} Array of turn objects with idx, speaker, and text
 */
export function parseTranscript(rawTranscript) {
  if (!rawTranscript || typeof rawTranscript !== 'string') {
    return [];
  }

  const turns = [];
  const lines = rawTranscript.split('\n').filter(line => line.trim());

  let currentIdx = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (!trimmedLine) continue;

    // Parse bot messages
    if (trimmedLine.startsWith('bot:')) {
      const text = trimmedLine.substring(4).trim();
      if (text) {
        turns.push({
          idx: currentIdx++,
          speaker: 'agent',
          text: text
        });
      }
    }
    // Parse human messages
    else if (trimmedLine.startsWith('human:')) {
      const text = trimmedLine.substring(6).trim();
      if (text) {
        turns.push({
          idx: currentIdx++,
          speaker: 'caller',
          text: text
        });
      }
    }
    // Handle system messages or other formats (if any)
    else if (trimmedLine.startsWith('system:')) {
      const text = trimmedLine.substring(7).trim();
      if (text) {
        turns.push({
          idx: currentIdx++,
          speaker: 'system',
          text: text
        });
      }
    }
    // If no prefix, treat as continuation of previous turn
    // This handles multi-line messages
    else if (turns.length > 0) {
      // Append to the last turn's text
      turns[turns.length - 1].text += ' ' + trimmedLine;
    }
  }

  return turns;
}

/**
 * Generate a unique turn ID
 * Format: <callId>:<idx>
 *
 * @param {string} callId - The call ID
 * @param {number} idx - The turn index
 * @returns {string} Turn ID
 */
export function generateTurnId(callId, idx) {
  return `${callId}:${idx}`;
}

/**
 * Validate a parsed turn object
 *
 * @param {Object} turn - Turn object to validate
 * @returns {boolean} True if valid
 */
export function isValidTurn(turn) {
  return (
    turn &&
    typeof turn.idx === 'number' &&
    typeof turn.speaker === 'string' &&
    ['agent', 'caller', 'system'].includes(turn.speaker) &&
    typeof turn.text === 'string' &&
    turn.text.length > 0
  );
}
