/**
 * Command parser utility for chat commands like /help
 */

export interface CommandParseResult {
  isCommand: boolean;
  commandType?: 'help';
  strippedMessage: string;
  extractedPath?: string;
}

/**
 * Extracts repository/file paths from natural language text.
 * Supports Unix absolute, home directory, relative, and Windows paths.
 *
 * @param message - The message to extract path from
 * @returns The first path found, or undefined if no path detected
 *
 * @example
 * extractRepositoryPath("What is in /home/user/project") // => "/home/user/project"
 * extractRepositoryPath("Show me ~/projects/app") // => "~/projects/app"
 * extractRepositoryPath("Check ./src/components") // => "./src/components"
 * extractRepositoryPath("Analyze C:\\Users\\project") // => "C:\\Users\\project"
 */
export function extractRepositoryPath(message: string): string | undefined {
  // Priority order: try each pattern from most to least specific

  // 1. Unix absolute paths: /path/to/something
  // Matches: /home/user/project, /var/www/app, /usr/local/bin
  const unixAbsoluteRegex = /\/(?:[\w\-\.]+\/)*[\w\-\.]+/g;
  const unixMatches = message.match(unixAbsoluteRegex);
  if (unixMatches && unixMatches.length > 0) {
    // Filter out single slashes and return longest match
    const validPaths = unixMatches.filter(p => p.length > 1 && p !== '/');
    if (validPaths.length > 0) {
      // Return the longest path (most specific)
      return validPaths.reduce((longest, current) =>
        current.length > longest.length ? current : longest
      );
    }
  }

  // 2. Home directory paths: ~/path/to/something
  // Matches: ~/projects/app, ~/Documents/code
  const homeDirRegex = /~(?:\/[\w\-\.]+)+/g;
  const homeMatches = message.match(homeDirRegex);
  if (homeMatches && homeMatches.length > 0) {
    return homeMatches[0]; // Return first match
  }

  // 3. Relative paths: ./path/to/something or ../path
  // Matches: ./src/components, ../parent/dir
  const relativeRegex = /\.\.?(?:\/[\w\-\.]+)+/g;
  const relativeMatches = message.match(relativeRegex);
  if (relativeMatches && relativeMatches.length > 0) {
    return relativeMatches[0]; // Return first match
  }

  // 4. Windows paths: C:\path\to\something
  // Matches: C:\Users\project, D:\work\code
  const windowsRegex = /[A-Za-z]:\\(?:[\w\-\.]+\\)*[\w\-\.]+/g;
  const windowsMatches = message.match(windowsRegex);
  if (windowsMatches && windowsMatches.length > 0) {
    return windowsMatches[0]; // Return first match
  }

  // No path found
  return undefined;
}

/**
 * Parses a chat message to detect commands like /help.
 *
 * @param message - The raw user message to parse
 * @returns Parse result with command info and stripped message
 *
 * @example
 * parseCommand("/help What is in /home/user/project")
 * // => { isCommand: true, commandType: 'help',
 * //      strippedMessage: 'What is in /home/user/project',
 * //      extractedPath: '/home/user/project' }
 *
 * parseCommand("Normal message")
 * // => { isCommand: false, strippedMessage: 'Normal message' }
 */
export function parseCommand(message: string): CommandParseResult {
  const trimmedMessage = message.trim();

  // Check for /help command (case-insensitive)
  const helpRegex = /^\/help\s*/i;

  if (helpRegex.test(trimmedMessage)) {
    // Strip the /help prefix
    const strippedMessage = trimmedMessage.replace(helpRegex, '');

    // Extract repository path from the remaining message
    const extractedPath = extractRepositoryPath(strippedMessage);

    return {
      isCommand: true,
      commandType: 'help',
      strippedMessage,
      extractedPath,
    };
  }

  // Not a command, return original message
  return {
    isCommand: false,
    strippedMessage: trimmedMessage,
  };
}
