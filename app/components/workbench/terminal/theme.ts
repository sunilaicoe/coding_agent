import type { ITheme } from '@xterm/xterm';

const style = getComputedStyle(document.documentElement);
const cssVar = (token: string) => style.getPropertyValue(token) || undefined;

export function getTerminalTheme(overrides?: ITheme): ITheme {
  return {
    cursor: cssVar('--genesis-elements-terminal-cursorColor'),
    cursorAccent: cssVar('--genesis-elements-terminal-cursorColorAccent'),
    foreground: cssVar('--genesis-elements-terminal-textColor'),
    background: cssVar('--genesis-elements-terminal-backgroundColor'),
    selectionBackground: cssVar('--genesis-elements-terminal-selection-backgroundColor'),
    selectionForeground: cssVar('--genesis-elements-terminal-selection-textColor'),
    selectionInactiveBackground: cssVar('--genesis-elements-terminal-selection-backgroundColorInactive'),

    // ansi escape code colors
    black: cssVar('--genesis-elements-terminal-color-black'),
    red: cssVar('--genesis-elements-terminal-color-red'),
    green: cssVar('--genesis-elements-terminal-color-green'),
    yellow: cssVar('--genesis-elements-terminal-color-yellow'),
    blue: cssVar('--genesis-elements-terminal-color-blue'),
    magenta: cssVar('--genesis-elements-terminal-color-magenta'),
    cyan: cssVar('--genesis-elements-terminal-color-cyan'),
    white: cssVar('--genesis-elements-terminal-color-white'),
    brightBlack: cssVar('--genesis-elements-terminal-color-brightBlack'),
    brightRed: cssVar('--genesis-elements-terminal-color-brightRed'),
    brightGreen: cssVar('--genesis-elements-terminal-color-brightGreen'),
    brightYellow: cssVar('--genesis-elements-terminal-color-brightYellow'),
    brightBlue: cssVar('--genesis-elements-terminal-color-brightBlue'),
    brightMagenta: cssVar('--genesis-elements-terminal-color-brightMagenta'),
    brightCyan: cssVar('--genesis-elements-terminal-color-brightCyan'),
    brightWhite: cssVar('--genesis-elements-terminal-color-brightWhite'),

    ...overrides,
  };
}
